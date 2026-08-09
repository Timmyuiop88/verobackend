import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import {
  esimBuyDebug,
  esimBuyDebugError,
} from '../../common/debug/esim-buy-debug';
import { opsAlert } from '../../common/observability/ops-alert';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import {
  MAX_POLL_ATTEMPTS,
  POLL_ESIM_ORDER_QUEUE,
  POLL_JOB_NAME,
  nextPollDelayMs,
} from './fulfillment.constants';
import { FulfillmentService } from './fulfillment.service';

type PollJobData = {
  orderId: string;
  externalOrderId: string;
  attempt: number;
};

/**
 * Step 2 of fulfillment: poll for the allocated eSIM profile via short,
 * self-rescheduling delayed jobs instead of a blocking sleep loop. Each
 * invocation does a single HTTP call and either completes the order,
 * schedules the next poll, or (after MAX_POLL_ATTEMPTS) gives up and
 * refunds. The webhook can also resolve the order at any point — this
 * processor always re-checks order status first so the two never race
 * each other into an inconsistent state.
 */
@Processor(POLL_ESIM_ORDER_QUEUE)
export class PollEsimOrderProcessor extends WorkerHost {
  private readonly logger = new Logger(PollEsimOrderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
    private readonly fulfillmentService: FulfillmentService,
    @InjectQueue(POLL_ESIM_ORDER_QUEUE)
    private readonly pollQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<PollJobData>): Promise<void> {
    const { orderId, externalOrderId, attempt } = job.data;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      this.logger.warn(`Poll: order ${orderId} not found`);
      return;
    }

    // Webhook (or a reconciliation-triggered chain) may have already
    // resolved this order — nothing left to do.
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      esimBuyDebug('poll.skip.terminal', {
        orderId,
        status: order.status,
        attempt,
      });
      return;
    }

    esimBuyDebug('poll.start', {
      orderId,
      externalOrderId,
      attempt,
      maxAttempts: MAX_POLL_ATTEMPTS,
    });

    let profile;
    try {
      const queried = await this.esimAccess.queryOrder(externalOrderId);
      profile = queried.esimList?.[0];
      esimBuyDebug('poll.result', {
        orderId,
        attempt,
        hasProfile: Boolean(profile),
        iccid: profile?.iccid ?? null,
      });
    } catch (error) {
      // Transient query failure — treat like "not ready yet" and retry on
      // the normal poll schedule rather than failing the whole chain.
      esimBuyDebugError('poll.query_failed', error, { orderId, attempt });
      this.logger.warn(
        `Poll query failed for order ${orderId} (attempt ${attempt})`,
        error as Error,
      );
      profile = undefined;
    }

    if (profile?.iccid) {
      await this.fulfillmentService.completeFromProfile({
        orderId,
        externalOrderId,
        profile,
        source: 'poll',
      });
      return;
    }

    if (attempt >= MAX_POLL_ATTEMPTS) {
      this.logger.warn(
        `eSIM profile still not ready for order ${orderId} after ${attempt} polls — refunding`,
      );
      opsAlert('poll_exhausted_refunding', {
        orderId,
        externalOrderId,
        attempts: attempt,
      });
      await this.fulfillmentService.refundAndFail(
        orderId,
        'provider_provisioning_timeout',
      );
      return;
    }

    const nextAttempt = attempt + 1;
    await this.pollQueue.add(
      POLL_JOB_NAME,
      { orderId, externalOrderId, attempt: nextAttempt },
      {
        jobId: `${orderId}_poll_${nextAttempt}`,
        delay: nextPollDelayMs(nextAttempt),
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }
}
