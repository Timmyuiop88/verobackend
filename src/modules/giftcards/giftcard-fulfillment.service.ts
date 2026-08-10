import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  GiftCardIssuanceStatus,
  OrderStatus,
  Prisma,
  type GiftCardIssuance,
} from '@prisma/client';
import { SecretCryptoService } from '../../common/crypto/secret-crypto.service';
import { DomainEvent } from '../../common/events/domain-events';
import { opsAlert } from '../../common/observability/ops-alert';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  ReloadlyRedeemCode,
  ReloadlyTransaction,
  ReloadlyTransactionStatus,
} from '../integrations/reloadly/reloadly.types';
import { FulfillmentService } from '../fulfillment/fulfillment.service';

export type DecryptedCard = {
  cardNumber: string | null;
  pinCode: string | null;
  redemptionUrl: string | null;
};

const STATUS_MAP: Record<ReloadlyTransactionStatus, GiftCardIssuanceStatus> = {
  SUCCESSFUL: GiftCardIssuanceStatus.SUCCESSFUL,
  PENDING: GiftCardIssuanceStatus.PENDING,
  PROCESSING: GiftCardIssuanceStatus.PROCESSING,
  REFUNDED: GiftCardIssuanceStatus.REFUNDED,
  FAILED: GiftCardIssuanceStatus.FAILED,
};

/**
 * State transitions for gift card orders. The eSIM equivalent
 * (`FulfillmentService`) is reused for the refund path — that logic is
 * provider-agnostic — while issuance, code storage and completion live here
 * because the delivered asset is a secret rather than an eSIM profile.
 */
@Injectable()
export class GiftCardFulfillmentService {
  private readonly logger = new Logger(GiftCardFulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretCryptoService,
    private readonly fulfillment: FulfillmentService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  mapStatus(status: ReloadlyTransactionStatus): GiftCardIssuanceStatus {
    return STATUS_MAP[status] ?? GiftCardIssuanceStatus.PENDING;
  }

  /**
   * Persists what the provider actually charged. Catalog prices drift
   * between nightly syncs, so margin is only trustworthy when derived from
   * the transaction itself.
   */
  async recordTransaction(params: {
    orderId: string;
    transaction: ReloadlyTransaction;
  }): Promise<GiftCardIssuance> {
    const { orderId, transaction } = params;

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { amount: true, currency: true },
    });

    const amountCharged = toDecimal(transaction.amount);
    const feePaid = toDecimal(transaction.totalFee ?? transaction.fee);
    const discountReceived = toDecimal(transaction.discount);
    const senderCurrency = transaction.currencyCode ?? null;

    // Only comparable when the provider billed us in the same currency the
    // customer was charged in; otherwise margin needs an FX pass first.
    const providerCost =
      amountCharged && senderCurrency === order.currency
        ? amountCharged
            .add(feePaid ?? new Prisma.Decimal(0))
            .sub(discountReceived ?? new Prisma.Decimal(0))
        : null;
    const realizedMargin = providerCost
      ? order.amount.sub(providerCost).toDecimalPlaces(4)
      : null;

    if (realizedMargin && realizedMargin.lte(0)) {
      opsAlert('giftcard_sold_at_negative_margin', {
        orderId,
        retail: order.amount.toString(),
        providerCost: providerCost?.toString(),
        margin: realizedMargin.toString(),
      });
    }

    return this.prisma.giftCardIssuance.update({
      where: { orderId },
      data: {
        reloadlyTransactionId: transaction.transactionId
          ? BigInt(transaction.transactionId)
          : null,
        providerStatus: this.mapStatus(transaction.status),
        amountCharged,
        feePaid,
        discountReceived,
        realizedMargin,
        senderCurrency,
        rawResponse: redactTransaction(transaction),
      },
    });
  }

  async storeCodes(params: {
    orderId: string;
    codes: ReloadlyRedeemCode[];
  }): Promise<GiftCardIssuance> {
    const cards: DecryptedCard[] = params.codes.map((code) => ({
      cardNumber:
        code.cardNumber === undefined || code.cardNumber === null
          ? null
          : String(code.cardNumber),
      pinCode: code.pinCode ?? null,
      redemptionUrl: code.redemptionUrl ?? null,
    }));

    const usable = cards.filter(
      (card) => card.cardNumber || card.pinCode || card.redemptionUrl,
    );

    return this.prisma.giftCardIssuance.update({
      where: { orderId: params.orderId },
      data: {
        cardsEncrypted:
          usable.length > 0 ? this.crypto.encryptJson(usable) : null,
        cardCount: usable.length,
        codesFetchedAt: new Date(),
      },
    });
  }

  decryptCards(issuance: GiftCardIssuance): DecryptedCard[] {
    if (!issuance.cardsEncrypted) {
      return [];
    }
    return this.crypto.decryptJson<DecryptedCard[]>(issuance.cardsEncrypted);
  }

  /** Idempotent — the fulfill and poll paths can both land here. */
  async complete(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        giftCardIssuance: true,
        giftCardDenomination: { include: { product: true } },
      },
    });
    if (!order) {
      this.logger.warn(`complete: gift card order ${orderId} not found`);
      return;
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.COMPLETED },
    });

    this.eventEmitter.emit(DomainEvent.GiftCardIssued, {
      orderId,
      userId: order.userId,
      amount: order.amount.toString(),
      currency: order.currency,
      productName: order.giftCardDenomination?.product.name ?? 'Your gift card',
      faceValue: order.giftCardDenomination?.faceValue.toString() ?? '0',
      cardCount: order.giftCardIssuance?.cardCount ?? 0,
    });
  }

  /**
   * Refunds the customer and marks the issuance.
   *
   * Reloadly distinguishes REFUNDED (they already reversed their own charge)
   * from FAILED (they have not). We always make the customer whole either
   * way, but a FAILED transaction leaves money sitting with the provider, so
   * it is escalated for manual reconciliation rather than silently absorbed.
   */
  async failAndRefund(params: {
    orderId: string;
    reason: string;
    providerStatus?: GiftCardIssuanceStatus;
  }): Promise<void> {
    const { orderId, reason, providerStatus } = params;

    await this.prisma.giftCardIssuance.updateMany({
      where: { orderId },
      data: {
        ...(providerStatus ? { providerStatus } : {}),
      },
    });

    await this.fulfillment.refundAndFail(orderId, reason);

    if (providerStatus === GiftCardIssuanceStatus.FAILED) {
      opsAlert('giftcard_provider_failed_funds_not_reversed', {
        orderId,
        reason,
      });
    }
  }
}

function toDecimal(value: number | undefined | null): Prisma.Decimal | null {
  return value === undefined || value === null || !Number.isFinite(value)
    ? null
    : new Prisma.Decimal(value);
}

/**
 * Reloadly's transaction payload is safe today, but persisting a provider
 * blob verbatim is how secrets leak into logs and backups later. Strip
 * anything code-shaped before it reaches the database.
 */
function redactTransaction(
  transaction: ReloadlyTransaction,
): Prisma.InputJsonValue {
  const clone = { ...transaction } as Record<string, unknown>;
  for (const key of ['cardNumber', 'pinCode', 'redemptionUrl', 'cards']) {
    delete clone[key];
  }
  return clone as Prisma.InputJsonValue;
}
