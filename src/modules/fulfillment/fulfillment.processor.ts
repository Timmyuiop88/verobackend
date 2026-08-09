import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { OrderStatus, ProviderName } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import {
  esimBuyDebug,
  esimBuyDebugError,
} from '../../common/debug/esim-buy-debug';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EsimAccessBusinessError } from '../integrations/esim-access/esim-access.errors';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import {
  POLL_BASE_DELAY_MS,
  POLL_ESIM_ORDER_QUEUE,
  POLL_JOB_NAME,
  FULFILL_ORDER_QUEUE,
} from './fulfillment.constants';
import { FulfillmentService } from './fulfillment.service';

type FulfillJobData = { orderId: string };

/**
 * Step 1 of fulfillment: create the provider order. This is a single fast
 * HTTP call — it does NOT block waiting for the eSIM profile to be
 * allocated. Once the provider order exists, a delayed job is handed off
 * to the poll queue and this job completes immediately, freeing the worker.
 */
@Processor(FULFILL_ORDER_QUEUE)
export class FulfillmentProcessor extends WorkerHost {
  private readonly logger = new Logger(FulfillmentProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
    private readonly fulfillmentService: FulfillmentService,
    @InjectQueue(POLL_ESIM_ORDER_QUEUE)
    private readonly pollQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<FulfillJobData>): Promise<void> {
    const { orderId } = job.data;

    esimBuyDebug('7.worker.start', {
      orderId,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
    });

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { product: true, providerOrder: true },
    });

    if (!order) {
      esimBuyDebug('7.worker.order.miss', { orderId });
      this.logger.warn(`Order ${orderId} not found`);
      return;
    }

    if (!order.product) {
      // This queue only ever handles PURCHASE orders (top-ups run through
      // TOPUP_ORDER_QUEUE) — a missing product here is a data integrity bug,
      // not a transient failure. Fail fast rather than retry indefinitely.
      this.logger.error(`Order ${orderId} has no product; cannot fulfill`);
      await this.fulfillmentService.refundAndFail(orderId, 'missing_product');
      return;
    }

    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      esimBuyDebug('7.worker.skip.terminal', { orderId, status: order.status });
      return;
    }

    // If a previous attempt marked FAILED, resume fulfilling (do not skip)
    if (order.status === OrderStatus.FAILED) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.FULFILLING },
      });
    }

    let externalOrderId = order.providerOrder?.externalOrderId;

    if (!externalOrderId) {
      esimBuyDebug('8.provider.order.create.start', {
        orderId,
        packageCode: order.product.supplierSku,
        transactionId: order.id,
      });

      try {
        const created = await this.esimAccess.createOrder({
          transactionId: order.id,
          packageCode: order.product.supplierSku,
        });
        externalOrderId = created.orderNo;
        esimBuyDebug('8.provider.order.create.ok', {
          orderId,
          orderNo: externalOrderId,
        });

        await this.prisma.providerOrder.upsert({
          where: { orderId: order.id },
          create: {
            orderId: order.id,
            provider: ProviderName.ESIM_ACCESS,
            externalOrderId,
            status: 'ORDERED',
            rawResponse: created,
          },
          update: {
            externalOrderId,
            status: 'ORDERED',
            rawResponse: created,
          },
        });
      } catch (error) {
        esimBuyDebugError('8.provider.order.create.failed', error, { orderId });

        if (error instanceof EsimAccessBusinessError) {
          // Permanent, provider-rejected order (bad params, insufficient
          // balance, duplicate transactionId, etc.) — retrying the exact
          // same request will not help. Fail fast + refund now instead of
          // burning BullMQ retry attempts.
          this.logger.error(
            `eSIM Access rejected order ${orderId}: [${error.errorCode}] ${error.message}`,
          );
          await this.fulfillmentService.refundAndFail(
            orderId,
            `provider_rejected:${error.errorCode ?? 'unknown'}:${error.message}`,
          );
          return;
        }

        // Transient (network/5xx). Retry via BullMQ; only compensate once
        // every attempt has been exhausted.
        const maxAttempts = job.opts.attempts ?? 1;
        const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;
        this.logger.error(
          `Failed to create provider order for ${orderId} (attempt ${job.attemptsMade + 1}/${maxAttempts})`,
          error as Error,
        );

        if (!isLastAttempt) {
          throw error;
        }

        await this.fulfillmentService.refundAndFail(
          orderId,
          `provider_unavailable:${(error as Error).message}`,
        );
        return;
      }
    } else {
      esimBuyDebug('8.provider.order.reuse', { orderId, externalOrderId });
    }

    await this.pollQueue.add(
      POLL_JOB_NAME,
      { orderId, externalOrderId, attempt: 1 },
      {
        jobId: `${orderId}_poll_1`,
        delay: POLL_BASE_DELAY_MS,
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    esimBuyDebug('9.poll.scheduled', { orderId, externalOrderId });
  }
}
