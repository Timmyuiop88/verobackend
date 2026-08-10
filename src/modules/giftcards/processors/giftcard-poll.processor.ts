import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { GiftCardIssuanceStatus, OrderStatus } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ReloadlyService } from '../../integrations/reloadly/reloadly.service';
import { GiftCardFulfillmentService } from '../giftcard-fulfillment.service';
import {
  GIFTCARD_MAX_POLL_ATTEMPTS,
  GIFTCARD_POLL_JOB_NAME,
  GIFTCARD_POLL_QUEUE,
  giftCardPollDelayMs,
} from '../giftcards.constants';

type PollJobData = {
  orderId: string;
  transactionId: number;
  attempt: number;
};

/**
 * Waits out Reloadly transactions that come back PENDING or PROCESSING.
 *
 * Modelled on `PollEsimOrderProcessor`: short delayed jobs rather than a
 * blocking sleep, so a slow provider never occupies a worker. Roughly 4-5
 * minutes of total patience before the order is refunded.
 */
@Processor(GIFTCARD_POLL_QUEUE)
export class GiftCardPollProcessor extends WorkerHost {
  private readonly logger = new Logger(GiftCardPollProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reloadly: ReloadlyService,
    private readonly fulfillment: GiftCardFulfillmentService,
    @InjectQueue(GIFTCARD_POLL_QUEUE) private readonly pollQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<PollJobData>): Promise<void> {
    const { orderId, transactionId, attempt } = job.data;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) {
      return;
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      return;
    }

    const transaction = await this.reloadly.getTransaction(transactionId);
    await this.fulfillment.recordTransaction({ orderId, transaction });

    if (transaction.status === 'SUCCESSFUL') {
      const codes = await this.reloadly.getRedeemCodes(transactionId);
      await this.fulfillment.storeCodes({ orderId, codes });
      await this.fulfillment.complete(orderId);
      return;
    }

    if (transaction.status === 'REFUNDED') {
      await this.fulfillment.failAndRefund({
        orderId,
        reason: 'provider_refunded:reloadly_reversed_the_charge',
        providerStatus: GiftCardIssuanceStatus.REFUNDED,
      });
      return;
    }

    if (transaction.status === 'FAILED') {
      await this.fulfillment.failAndRefund({
        orderId,
        reason: 'provider_failed:transaction_failed',
        providerStatus: GiftCardIssuanceStatus.FAILED,
      });
      return;
    }

    if (attempt >= GIFTCARD_MAX_POLL_ATTEMPTS) {
      this.logger.error(
        `Gift card order ${orderId} still ${transaction.status} after ${attempt} polls — refunding`,
      );
      await this.fulfillment.failAndRefund({
        orderId,
        reason: `provider_timeout:still_${transaction.status.toLowerCase()}_after_${attempt}_polls`,
        providerStatus: GiftCardIssuanceStatus.FAILED,
      });
      return;
    }

    const next = attempt + 1;
    await this.pollQueue.add(
      GIFTCARD_POLL_JOB_NAME,
      { orderId, transactionId, attempt: next },
      {
        jobId: `${orderId}:poll:${next}`,
        delay: giftCardPollDelayMs(next),
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }
}
