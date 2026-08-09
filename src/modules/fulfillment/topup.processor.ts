import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { Job } from 'bullmq';
import {
  esimBuyDebug,
  esimBuyDebugError,
} from '../../common/debug/esim-buy-debug';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EsimAccessBusinessError } from '../integrations/esim-access/esim-access.errors';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import { TOPUP_ORDER_QUEUE } from './fulfillment.constants';
import { FulfillmentService } from './fulfillment.service';

type TopUpJobData = {
  orderId: string;
  providerOrderId: string;
  iccid: string;
  packageCode: string;
};

/**
 * Top-up is a single synchronous provider call against an already-installed
 * eSIM — no allocation/poll phase like a fresh purchase. This processor just
 * exists to keep the external call (and its retry/compensation logic) off
 * the request thread, mirroring FulfillmentProcessor's error classification:
 * permanent provider rejections refund immediately, transient failures retry
 * via BullMQ and only refund once attempts are exhausted.
 */
@Processor(TOPUP_ORDER_QUEUE)
export class TopUpProcessor extends WorkerHost {
  private readonly logger = new Logger(TopUpProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
    private readonly fulfillmentService: FulfillmentService,
  ) {
    super();
  }

  async process(job: Job<TopUpJobData>): Promise<void> {
    const { orderId, providerOrderId, iccid, packageCode } = job.data;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      this.logger.warn(`Top-up order ${orderId} not found`);
      return;
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      return;
    }
    if (order.status === OrderStatus.FAILED) {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.FULFILLING },
      });
    }

    esimBuyDebug('topup.worker.start', { orderId, iccid, packageCode });

    try {
      const result = await this.esimAccess.topUpEsim({
        transactionId: orderId,
        packageCode,
        iccid,
      });
      esimBuyDebug('topup.worker.ok', { orderId, iccid: result.iccid });

      await this.fulfillmentService.completeTopUp({
        topUpOrderId: orderId,
        providerOrderId,
        result,
      });
    } catch (error) {
      esimBuyDebugError('topup.worker.failed', error, { orderId });

      if (error instanceof EsimAccessBusinessError) {
        this.logger.error(
          `eSIM Access rejected top-up ${orderId}: [${error.errorCode}] ${error.message}`,
        );
        await this.fulfillmentService.refundAndFail(
          orderId,
          `provider_rejected:${error.errorCode ?? 'unknown'}:${error.message}`,
        );
        return;
      }

      const maxAttempts = job.opts.attempts ?? 1;
      const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;
      this.logger.error(
        `Top-up call failed for ${orderId} (attempt ${job.attemptsMade + 1}/${maxAttempts})`,
        error as Error,
      );

      if (!isLastAttempt) {
        throw error;
      }

      await this.fulfillmentService.refundAndFail(
        orderId,
        `provider_unavailable:${(error as Error).message}`,
      );
    }
  }
}
