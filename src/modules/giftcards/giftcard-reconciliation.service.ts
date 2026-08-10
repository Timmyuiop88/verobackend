import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { GiftCardIssuanceStatus, OrderStatus, OrderType } from '@prisma/client';
import { Queue } from 'bullmq';
import { opsAlert } from '../../common/observability/ops-alert';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReloadlyService } from '../integrations/reloadly/reloadly.service';
import { GiftCardFulfillmentService } from './giftcard-fulfillment.service';
import {
  GIFTCARD_FULFILL_JOB_ATTEMPTS,
  GIFTCARD_FULFILL_JOB_BACKOFF_MS,
  GIFTCARD_FULFILL_JOB_NAME,
  GIFTCARD_FULFILL_QUEUE,
} from './giftcards.constants';

/** How long an order may sit in FULFILLING before the sweep intervenes. */
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

/**
 * Safety net for gift card fulfillment, mirroring the eSIM
 * `ReconciliationService`.
 *
 * The failure that matters most here is money-shaped: the process dying
 * between the Reloadly order succeeding and us recording the transaction.
 * The customer has been debited, Reloadly has issued a card, and nothing
 * links the two. This sweep re-enqueues those orders, and the fulfill
 * worker's `customIdentifier` reconciliation recovers the existing
 * transaction rather than buying a second card.
 */
@Injectable()
export class GiftCardReconciliationService {
  private readonly logger = new Logger(GiftCardReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reloadly: ReloadlyService,
    private readonly fulfillment: GiftCardFulfillmentService,
    @InjectQueue(GIFTCARD_FULFILL_QUEUE) private readonly fulfillQueue: Queue,
  ) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweepStuckOrders(): Promise<void> {
    if (!this.reloadly.isConfigured) {
      return;
    }

    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);
    const stuck = await this.prisma.order.findMany({
      where: {
        orderType: OrderType.GIFT_CARD,
        status: OrderStatus.FULFILLING,
        updatedAt: { lt: cutoff },
      },
      take: 50,
    });

    if (stuck.length === 0) {
      return;
    }

    this.logger.warn(
      `Gift card reconciliation found ${stuck.length} stuck order(s)`,
    );
    opsAlert('giftcard_reconciliation_stuck_orders_found', {
      count: stuck.length,
      orderIds: stuck.map((order) => order.id),
    });

    for (const order of stuck) {
      await this.fulfillQueue.add(
        GIFTCARD_FULFILL_JOB_NAME,
        { orderId: order.id },
        {
          jobId: `${order.id}:reconcile:${Date.now()}`,
          attempts: GIFTCARD_FULFILL_JOB_ATTEMPTS,
          backoff: {
            type: 'exponential',
            delay: GIFTCARD_FULFILL_JOB_BACKOFF_MS,
          },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    }
  }

  /**
   * Issuances the provider marked SUCCESSFUL whose codes never landed. The
   * sale happened and the customer paid, so the card exists and only needs
   * fetching — the fulfill queue can't help here because it short-circuits
   * on orders that already reached a terminal status.
   */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async sweepMissingCodes(): Promise<void> {
    if (!this.reloadly.isConfigured) {
      return;
    }

    const missing = await this.prisma.giftCardIssuance.findMany({
      where: {
        providerStatus: GiftCardIssuanceStatus.SUCCESSFUL,
        cardsEncrypted: null,
        reloadlyTransactionId: { not: null },
      },
      take: 25,
    });

    if (missing.length === 0) {
      return;
    }

    opsAlert('giftcard_successful_without_codes', {
      count: missing.length,
      orderIds: missing.map((issuance) => issuance.orderId),
    });

    for (const issuance of missing) {
      try {
        const codes = await this.reloadly.getRedeemCodes(
          Number(issuance.reloadlyTransactionId),
        );
        await this.fulfillment.storeCodes({ orderId: issuance.orderId, codes });
        await this.fulfillment.complete(issuance.orderId);
      } catch (error) {
        this.logger.error(
          `Could not recover codes for gift card order ${issuance.orderId}: ${(error as Error).message}`,
        );
      }
    }
  }
}
