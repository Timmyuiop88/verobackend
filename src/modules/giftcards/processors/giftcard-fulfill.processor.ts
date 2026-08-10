import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { GiftCardIssuanceStatus, OrderStatus, Prisma } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { opsAlert } from '../../../common/observability/ops-alert';
import { PrismaService } from '../../../common/prisma/prisma.service';
import {
  ReloadlyBusinessError,
  ReloadlyDuplicateOrderError,
} from '../../integrations/reloadly/reloadly.errors';
import { ReloadlyService } from '../../integrations/reloadly/reloadly.service';
import type { ReloadlyTransaction } from '../../integrations/reloadly/reloadly.types';
import { GiftCardFulfillmentService } from '../giftcard-fulfillment.service';
import {
  GIFTCARD_FULFILL_QUEUE,
  GIFTCARD_POLL_JOB_NAME,
  GIFTCARD_POLL_QUEUE,
  giftCardPollDelayMs,
} from '../giftcards.constants';

type FulfillJobData = {
  orderId: string;
  recipientEmail?: string;
  externalUserId?: string;
};

/**
 * Places the Reloadly order and delivers the codes.
 *
 * The hard problem here is that `POST /orders` moves real money, so an
 * ambiguous failure (timeout, dropped connection) can't be distinguished
 * from a success. Two mechanisms handle that: our order id is sent as
 * Reloadly's `customIdentifier`, and every retry reconciles against that
 * identifier before considering placing another order.
 */
@Processor(GIFTCARD_FULFILL_QUEUE)
export class GiftCardFulfillProcessor extends WorkerHost {
  private readonly logger = new Logger(GiftCardFulfillProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reloadly: ReloadlyService,
    private readonly fulfillment: GiftCardFulfillmentService,
    @InjectQueue(GIFTCARD_POLL_QUEUE) private readonly pollQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<FulfillJobData>): Promise<void> {
    const { orderId, recipientEmail, externalUserId } = job.data;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        giftCardIssuance: true,
        giftCardDenomination: { include: { product: true } },
      },
    });

    if (!order?.giftCardIssuance || !order.giftCardDenomination) {
      this.logger.warn(`Gift card order ${orderId} is missing its issuance`);
      return;
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      return;
    }

    const { giftCardIssuance: issuance, giftCardDenomination: denomination } =
      order;

    let transaction: ReloadlyTransaction | null = null;

    // A previous attempt may have succeeded before failing to report back.
    // Never place a second order without ruling that out first.
    if (job.attemptsMade > 0 || issuance.reloadlyTransactionId) {
      transaction = await this.recover(issuance.customIdentifier);
      if (transaction) {
        this.logger.log(
          `Recovered existing Reloadly transaction ${transaction.transactionId} for order ${orderId}`,
        );
      }
    }

    if (!transaction) {
      const guard = await this.preflightBalance(
        denomination.senderCost,
        orderId,
      );
      if (!guard.ok) {
        await this.fulfillment.failAndRefund({
          orderId,
          reason: guard.reason,
          providerStatus: GiftCardIssuanceStatus.FAILED,
        });
        return;
      }

      try {
        transaction = await this.reloadly.orderGiftCard({
          productId: denomination.product.externalProductId,
          quantity: issuance.quantity,
          unitPrice: Number(denomination.faceValue),
          customIdentifier: issuance.customIdentifier,
          senderName: this.reloadly.defaultSenderName,
          ...(recipientEmail ? { recipientEmail } : {}),
          ...(externalUserId
            ? { productAdditionalRequirements: { userId: externalUserId } }
            : {}),
          preOrder: false,
        });
      } catch (error) {
        if (error instanceof ReloadlyDuplicateOrderError) {
          transaction = await this.recover(issuance.customIdentifier);
          if (!transaction) {
            // Reloadly says the identifier is taken but won't show us the
            // transaction — refunding could double-spend, so a human decides.
            opsAlert('giftcard_duplicate_without_transaction', { orderId });
            throw error;
          }
        } else if (error instanceof ReloadlyBusinessError) {
          this.logger.error(
            `Reloadly rejected gift card order ${orderId}: [${error.errorCode ?? error.httpStatus}] ${error.message}`,
          );
          await this.fulfillment.failAndRefund({
            orderId,
            reason: `provider_rejected:${error.errorCode ?? error.httpStatus}:${error.message}`,
            providerStatus: GiftCardIssuanceStatus.FAILED,
          });
          return;
        } else {
          await this.handleTransientFailure(job, orderId, error as Error);
          return;
        }
      }
    }

    await this.fulfillment.recordTransaction({ orderId, transaction });
    await this.resolve(orderId, transaction);
  }

  /**
   * Branches on the provider's transaction status. SUCCESSFUL pulls the
   * codes; PENDING/PROCESSING hands off to the poll queue; the two terminal
   * failure statuses refund, with FAILED additionally flagged because
   * Reloadly has not reversed its own charge in that case.
   */
  private async resolve(
    orderId: string,
    transaction: ReloadlyTransaction,
  ): Promise<void> {
    switch (transaction.status) {
      case 'SUCCESSFUL': {
        const codes = await this.reloadly.getRedeemCodes(
          transaction.transactionId,
        );
        await this.fulfillment.storeCodes({ orderId, codes });
        await this.fulfillment.complete(orderId);
        return;
      }
      case 'PENDING':
      case 'PROCESSING': {
        await this.pollQueue.add(
          GIFTCARD_POLL_JOB_NAME,
          {
            orderId,
            transactionId: transaction.transactionId,
            attempt: 1,
          },
          {
            jobId: `${orderId}:poll:1`,
            delay: giftCardPollDelayMs(1),
            removeOnComplete: 100,
            removeOnFail: 200,
          },
        );
        return;
      }
      case 'REFUNDED':
        await this.fulfillment.failAndRefund({
          orderId,
          reason: 'provider_refunded:reloadly_reversed_the_charge',
          providerStatus: GiftCardIssuanceStatus.REFUNDED,
        });
        return;
      case 'FAILED':
      default:
        await this.fulfillment.failAndRefund({
          orderId,
          reason: `provider_failed:${transaction.status}`,
          providerStatus: GiftCardIssuanceStatus.FAILED,
        });
    }
  }

  private async recover(
    customIdentifier: string,
  ): Promise<ReloadlyTransaction | null> {
    try {
      return await this.reloadly.findTransactionByCustomIdentifier(
        customIdentifier,
      );
    } catch (error) {
      this.logger.warn(
        `Could not reconcile gift card order ${customIdentifier}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Reloadly is prepaid, so an empty balance fails every order. Checking
   * first turns a stream of customer-visible failures into one ops alert.
   */
  private async preflightBalance(
    unitCost: Prisma.Decimal,
    orderId: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const balance = await this.reloadly.getBalance();

      if (balance.balance < Number(unitCost)) {
        opsAlert('giftcard_provider_balance_exhausted', {
          orderId,
          balance: balance.balance,
          currency: balance.currencyCode,
          required: unitCost.toString(),
        });
        return { ok: false, reason: 'provider_balance_insufficient' };
      }

      if (balance.balance < this.reloadly.minimumBalanceAlertThreshold) {
        opsAlert('giftcard_provider_balance_low', {
          balance: balance.balance,
          currency: balance.currencyCode,
          threshold: this.reloadly.minimumBalanceAlertThreshold,
        });
      }
      return { ok: true };
    } catch (error) {
      // A balance lookup failure is not a reason to refuse the sale — let
      // the order attempt speak for itself.
      this.logger.warn(
        `Reloadly balance check failed: ${(error as Error).message}`,
      );
      return { ok: true };
    }
  }

  private async handleTransientFailure(
    job: Job<FulfillJobData>,
    orderId: string,
    error: Error,
  ): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;

    this.logger.error(
      `Gift card order ${orderId} failed (attempt ${job.attemptsMade + 1}/${maxAttempts}): ${error.message}`,
    );

    if (!isLastAttempt) {
      throw error;
    }

    // Last chance: the order may have landed despite the error. Only refund
    // once the provider confirms there is nothing under our identifier.
    const recovered = await this.recover(orderId);
    if (recovered) {
      await this.fulfillment.recordTransaction({
        orderId,
        transaction: recovered,
      });
      await this.resolve(orderId, recovered);
      return;
    }

    await this.fulfillment.failAndRefund({
      orderId,
      reason: `provider_unavailable:${error.message}`,
      providerStatus: GiftCardIssuanceStatus.FAILED,
    });
  }
}
