import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { OrderStatus, OrderType } from '@prisma/client';
import { Queue } from 'bullmq';
import { opsAlert } from '../../common/observability/ops-alert';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  FULFILL_JOB_ATTEMPTS,
  FULFILL_JOB_BACKOFF_MS,
  FULFILL_JOB_NAME,
  FULFILL_ORDER_QUEUE,
  POLL_BASE_DELAY_MS,
  POLL_ESIM_ORDER_QUEUE,
  POLL_JOB_NAME,
  RECONCILE_CRON,
  STUCK_ORDER_THRESHOLD_MS,
} from './fulfillment.constants';

/**
 * Safety net for the fulfillment pipeline. BullMQ delayed jobs survive
 * process restarts, and webhooks can complete an order at any time — but a
 * crash between DB write and job scheduling, a dropped job, or an
 * unexpected provider outage can still wedge an order in FULFILLING
 * indefinitely. This sweep finds those and gets them moving again.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(FULFILL_ORDER_QUEUE) private readonly fulfillQueue: Queue,
    @InjectQueue(POLL_ESIM_ORDER_QUEUE) private readonly pollQueue: Queue,
  ) {}

  @Cron(RECONCILE_CRON)
  async sweepStuckOrders(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_ORDER_THRESHOLD_MS);

    const stuck = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.FULFILLING,
        updatedAt: { lt: cutoff },
        // eSIM order types only — gift cards wedge for entirely different
        // reasons and have their own sweep against the Reloadly API.
        orderType: { in: [OrderType.PURCHASE, OrderType.TOPUP] },
      },
      include: { providerOrder: true },
      take: 50,
    });

    if (stuck.length === 0) {
      return;
    }

    this.logger.warn(
      `Reconciliation sweep found ${stuck.length} stuck order(s)`,
    );
    opsAlert('reconciliation_stuck_orders_found', {
      count: stuck.length,
      orderIds: stuck.map((o) => o.id),
    });

    for (const order of stuck) {
      const sweepTag = Date.now();

      if (!order.providerOrder?.externalOrderId) {
        // The provider order was never created (e.g. app crashed right
        // after debiting the wallet, before the fulfill job ran).
        await this.fulfillQueue.add(
          FULFILL_JOB_NAME,
          { orderId: order.id },
          {
            jobId: `${order.id}_reconcile_${sweepTag}`,
            attempts: FULFILL_JOB_ATTEMPTS,
            backoff: { type: 'exponential', delay: FULFILL_JOB_BACKOFF_MS },
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
        continue;
      }

      if (!order.providerOrder.iccid) {
        // Provider order exists but the poll chain died somewhere — restart it.
        await this.pollQueue.add(
          POLL_JOB_NAME,
          {
            orderId: order.id,
            externalOrderId: order.providerOrder.externalOrderId,
            attempt: 1,
          },
          {
            jobId: `${order.id}_poll_reconcile_${sweepTag}`,
            delay: POLL_BASE_DELAY_MS,
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
      }
    }
  }
}
