import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  GiftCardIssuanceStatus,
  OrderStatus,
  PaymentIntentStatus,
  PaymentProvider,
  ProviderName,
} from '@prisma/client';
import { createHash } from 'crypto';
import { esimBuyDebug } from '../../common/debug/esim-buy-debug';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { GiftCardFulfillmentService } from '../giftcards/giftcard-fulfillment.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import type { EsimProfile } from '../integrations/esim-access/esim-access.service';
import { OxapayService } from '../integrations/oxapay/oxapay.service';
import { PaystackService } from '../integrations/paystack/paystack.service';
import { ReloadlyService } from '../integrations/reloadly/reloadly.service';
import type {
  ReloadlyTransaction,
  ReloadlyTransactionStatus,
} from '../integrations/reloadly/reloadly.types';
import { WalletService } from '../wallet/wallet.service';

type ReloadlyWebhookPayload = {
  type?: string;
  data?: Partial<ReloadlyTransaction> & {
    transactionId?: number | string;
    status?: string;
    customIdentifier?: string;
  };
  transactionId?: number | string;
  status?: string;
  customIdentifier?: string;
};

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly oxapay: OxapayService,
    private readonly esimAccess: EsimAccessService,
    private readonly reloadly: ReloadlyService,
    private readonly walletService: WalletService,
    private readonly fulfillmentService: FulfillmentService,
    private readonly giftCardFulfillment: GiftCardFulfillmentService,
  ) {}

  private eventId(provider: string, raw: string): string {
    return createHash('sha256').update(`${provider}:${raw}`).digest('hex');
  }

  private async beginEvent(
    provider: string,
    eventId: string,
    payload: unknown,
  ): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider,
          eventId,
          payload: payload as object,
        },
      });
      return true;
    } catch {
      // Unique constraint — already processed or in-flight
      const existing = await this.prisma.webhookEvent.findUnique({
        where: { provider_eventId: { provider, eventId } },
      });
      return !existing?.processedAt;
    }
  }

  private async markProcessed(
    provider: string,
    eventId: string,
  ): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { provider_eventId: { provider, eventId } },
      data: { processedAt: new Date() },
    });
  }

  async handlePaystack(
    rawBody: Buffer,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    if (
      !signature ||
      !this.paystack.verifyWebhookSignature(rawBody, signature)
    ) {
      throw new BadRequestException('Invalid Paystack signature');
    }

    const payload = JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      data?: {
        reference?: string;
        status?: string;
        amount?: number;
        currency?: string;
      };
    };

    const eventId = this.eventId(
      'paystack',
      payload.data?.reference
        ? `${payload.event}:${payload.data.reference}`
        : rawBody.toString('utf8'),
    );

    const shouldProcess = await this.beginEvent('paystack', eventId, payload);
    if (!shouldProcess) {
      return { received: true };
    }

    if (
      payload.event === 'charge.success' &&
      payload.data?.status === 'success' &&
      payload.data.reference
    ) {
      const intent = await this.prisma.paymentIntent.findFirst({
        where: {
          provider: PaymentProvider.PAYSTACK,
          externalId: payload.data.reference,
        },
      });

      if (intent && intent.status !== PaymentIntentStatus.COMPLETED) {
        await this.walletService.credit({
          userId: intent.userId,
          amount: intent.amount,
          reference: `deposit_paystack_${intent.externalId}`,
          metadata: { paymentIntentId: intent.id },
        });

        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: PaymentIntentStatus.COMPLETED },
        });
      }
    }

    await this.markProcessed('paystack', eventId);
    return { received: true };
  }

  async handleOxapay(
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature || !this.oxapay.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid OxaPay signature');
    }

    const payload = JSON.parse(rawBody) as {
      status?: string;
      order_id?: string;
      track_id?: string;
      amount?: number;
    };

    const eventId = this.eventId(
      'oxapay',
      payload.track_id || payload.order_id || rawBody,
    );

    const shouldProcess = await this.beginEvent('oxapay', eventId, payload);
    if (!shouldProcess) {
      return { received: true };
    }

    const paid =
      payload.status?.toLowerCase() === 'paid' ||
      payload.status?.toLowerCase() === 'complete' ||
      payload.status?.toLowerCase() === 'completed';

    if (paid && payload.order_id) {
      const intent = await this.prisma.paymentIntent.findFirst({
        where: {
          provider: PaymentProvider.OXAPAY,
          externalId: payload.order_id,
        },
      });

      if (intent && intent.status !== PaymentIntentStatus.COMPLETED) {
        await this.walletService.credit({
          userId: intent.userId,
          amount: intent.amount,
          reference: `deposit_oxapay_${intent.externalId}`,
          metadata: {
            paymentIntentId: intent.id,
            trackId: payload.track_id,
          },
        });

        await this.prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { status: PaymentIntentStatus.COMPLETED },
        });
      }
    }

    await this.markProcessed('oxapay', eventId);
    return { received: true };
  }

  async handleEsimAccess(
    rawBody: string,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!this.esimAccess.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid eSIM Access signature');
    }

    const payload = JSON.parse(rawBody) as {
      notifyType?: string;
      orderNo?: string;
      content?: {
        orderNo?: string;
        esimTranNo?: string;
        orderUsage?: number;
        totalVolume?: number;
        expiredTime?: string;
        esimStatus?: string;
        smdpStatus?: string;
        iccid?: string;
        ac?: string;
        qrCodeUrl?: string;
      };
    };

    const orderNo = payload.orderNo || payload.content?.orderNo;
    const eventId = this.eventId(
      'esim-access',
      `${payload.notifyType || 'event'}:${orderNo || rawBody}`,
    );

    const shouldProcess = await this.beginEvent(
      'esim-access',
      eventId,
      payload,
    );
    if (!shouldProcess) {
      return { received: true };
    }

    esimBuyDebug('webhook.esim-access.received', {
      notifyType: payload.notifyType,
      orderNo,
    });

    if (payload.notifyType === 'CHECK_HEALTH') {
      esimBuyDebug('webhook.esim-access.health_ok', {});
      await this.markProcessed('esim-access', eventId);
      return { received: true };
    }

    if (!orderNo) {
      await this.markProcessed('esim-access', eventId);
      return { received: true };
    }

    const providerOrder = await this.prisma.providerOrder.findFirst({
      where: {
        provider: ProviderName.ESIM_ACCESS,
        externalOrderId: orderNo,
      },
    });

    if (!providerOrder) {
      esimBuyDebug('webhook.esim-access.unknown_order', { orderNo });
      await this.markProcessed('esim-access', eventId);
      return { received: true };
    }

    const content = payload.content ?? {};

    // ORDER_STATUS webhooks are a light payload without ICCID and without
    // the richer fields (apn/pin/puk/shortUrl) the provider backfills a
    // little later — query for the full profile whenever we don't have an
    // ICCID on file yet, so completion always carries as much detail as
    // the provider currently has, not just what this one event happened to include.
    let queriedProfile: EsimProfile | undefined;
    if (!content.iccid && !providerOrder.iccid) {
      try {
        const queried = await this.esimAccess.queryOrder(orderNo);
        queriedProfile = queried.esimList?.[0];
      } catch (error) {
        this.logger.warn(
          `Failed to refresh eSIM order ${orderNo}`,
          error as Error,
        );
      }
    }

    const iccid = queriedProfile?.iccid ?? content.iccid ?? providerOrder.iccid;

    if (iccid) {
      // ICCID confirmed — hand off to the shared completion path, which
      // idempotently upserts the provider order + usage and either
      // completes the order or (if it was already refunded) triggers the
      // late-fulfillment cancel/revoke safety valve.
      await this.fulfillmentService.completeFromProfile({
        orderId: providerOrder.orderId,
        externalOrderId: orderNo,
        profile: queriedProfile ?? {
          esimTranNo: content.esimTranNo ?? providerOrder.esimTranNo ?? '',
          orderNo,
          iccid,
          ac: content.ac ?? providerOrder.lpaCode ?? '',
          qrCodeUrl: content.qrCodeUrl ?? providerOrder.qrCodeUrl ?? '',
          smdpStatus: content.smdpStatus ?? providerOrder.status ?? '',
          esimStatus: content.esimStatus ?? providerOrder.status ?? '',
          orderUsage: content.orderUsage,
          totalVolume: content.totalVolume,
          expiredTime: content.expiredTime,
        },
        source: 'webhook',
      });
    } else {
      const status =
        content.esimStatus || content.smdpStatus || providerOrder.status;
      // Lifecycle ping before allocation completes, or a usage-only update
      // for an already-completed order — persist the snapshot, no status change.
      await this.prisma.providerOrder.update({
        where: { id: providerOrder.id },
        data: { status, rawResponse: payload },
      });

      if (
        content.orderUsage !== undefined ||
        content.totalVolume !== undefined ||
        content.expiredTime
      ) {
        await this.prisma.esimUsage.upsert({
          where: { providerOrderId: providerOrder.id },
          create: {
            providerOrderId: providerOrder.id,
            dataUsedBytes: BigInt(content.orderUsage ?? 0),
            dataTotalBytes:
              content.totalVolume !== undefined
                ? BigInt(content.totalVolume)
                : null,
            expiresAt: content.expiredTime
              ? new Date(content.expiredTime)
              : null,
            lastSyncedAt: new Date(),
          },
          update: {
            dataUsedBytes:
              content.orderUsage !== undefined
                ? BigInt(content.orderUsage)
                : undefined,
            dataTotalBytes:
              content.totalVolume !== undefined
                ? BigInt(content.totalVolume)
                : undefined,
            expiresAt: content.expiredTime
              ? new Date(content.expiredTime)
              : undefined,
            lastSyncedAt: new Date(),
          },
        });
      }
    }

    await this.markProcessed('esim-access', eventId);
    return { received: true };
  }

  /**
   * Reloadly gift card status callbacks.
   *
   * Configure in Dashboard → Developers → Webhooks:
   *   URL:     https://<host>/api/v1/webhooks/reloadly
   *   Service: Gift Cards
   *   Event:   giftcard_transaction.status
   *
   * Signature: HMAC-SHA256 hex of `rawBody + ":" + X-Reloadly-Request-Timestamp`
   * using the webhook signing secret (not the API client secret).
   *
   * Responds 200 quickly. Heavy work (code fetch) is still inline because it
   * is a single API call and the poll path already does the same — the
   * 3-second Reloadly timeout is usually enough. Idempotent via webhookEvent
   * + existing COMPLETED/REFUNDED short-circuits.
   */
  async handleReloadly(
    rawBody: string,
    signature: string | undefined,
    timestamp: string | undefined,
  ): Promise<{ received: true }> {
    if (
      !this.reloadly.verifyWebhookSignature({
        rawBody,
        signature,
        timestamp,
      })
    ) {
      throw new BadRequestException('Invalid Reloadly webhook signature');
    }

    const payload = JSON.parse(rawBody) as ReloadlyWebhookPayload;
    const eventType = payload.type ?? 'giftcard_transaction.status';
    const data = payload.data ?? payload;

    const transactionIdRaw = data.transactionId;
    const customIdentifier =
      typeof data.customIdentifier === 'string'
        ? data.customIdentifier
        : undefined;
    const statusHint =
      typeof data.status === 'string'
        ? (data.status.toUpperCase() as ReloadlyTransactionStatus)
        : undefined;

    const eventId = this.eventId(
      'reloadly',
      [
        eventType,
        transactionIdRaw ?? '',
        customIdentifier ?? '',
        statusHint ?? '',
        timestamp ?? '',
      ].join(':'),
    );

    const shouldProcess = await this.beginEvent('reloadly', eventId, payload);
    if (!shouldProcess) {
      return { received: true };
    }

    // We only sell gift cards — ignore airtime (and anything else).
    if (eventType !== 'giftcard_transaction.status') {
      this.logger.debug(`Ignoring Reloadly webhook type ${eventType}`);
      await this.markProcessed('reloadly', eventId);
      return { received: true };
    }

    const issuance = await this.findGiftCardIssuance({
      customIdentifier,
      transactionId: transactionIdRaw,
    });

    if (!issuance) {
      this.logger.warn(
        `Reloadly webhook for unknown gift card order (customIdentifier=${customIdentifier}, transactionId=${transactionIdRaw})`,
      );
      await this.markProcessed('reloadly', eventId);
      return { received: true };
    }

    const order = await this.prisma.order.findUnique({
      where: { id: issuance.orderId },
      select: { id: true, status: true },
    });
    if (
      !order ||
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      await this.markProcessed('reloadly', eventId);
      return { received: true };
    }

    // Prefer the authoritative transaction from the API over the webhook
    // body — webhook payloads have been observed both thin and full.
    let transaction: ReloadlyTransaction | null = null;
    const transactionId = Number(
      transactionIdRaw ?? issuance.reloadlyTransactionId ?? NaN,
    );

    if (Number.isFinite(transactionId)) {
      try {
        transaction = await this.reloadly.getTransaction(transactionId);
      } catch (error) {
        this.logger.warn(
          `Could not refresh Reloadly transaction ${transactionId}: ${(error as Error).message}`,
        );
      }
    }

    if (!transaction && customIdentifier) {
      transaction = await this.reloadly.findTransactionByCustomIdentifier(
        customIdentifier,
      );
    }

    if (!transaction) {
      // Fall back to the webhook's own fields so a transient API blip
      // doesn't drop a terminal status update entirely.
      if (statusHint && Number.isFinite(transactionId)) {
        transaction = {
          transactionId,
          status: statusHint,
          customIdentifier,
        };
      } else {
        this.logger.warn(
          `Reloadly webhook could not resolve a transaction for order ${issuance.orderId}`,
        );
        await this.markProcessed('reloadly', eventId);
        return { received: true };
      }
    }

    await this.giftCardFulfillment.recordTransaction({
      orderId: issuance.orderId,
      transaction,
    });

    switch (transaction.status) {
      case 'SUCCESSFUL': {
        const codes = await this.reloadly.getRedeemCodes(
          transaction.transactionId,
        );
        await this.giftCardFulfillment.storeCodes({
          orderId: issuance.orderId,
          codes,
        });
        await this.giftCardFulfillment.complete(issuance.orderId);
        break;
      }
      case 'REFUNDED':
        await this.giftCardFulfillment.failAndRefund({
          orderId: issuance.orderId,
          reason: 'provider_refunded:reloadly_webhook',
          providerStatus: GiftCardIssuanceStatus.REFUNDED,
        });
        break;
      case 'FAILED':
        await this.giftCardFulfillment.failAndRefund({
          orderId: issuance.orderId,
          reason: 'provider_failed:reloadly_webhook',
          providerStatus: GiftCardIssuanceStatus.FAILED,
        });
        break;
      case 'PENDING':
      case 'PROCESSING':
      default:
        // Poll chain continues — webhook just refreshed the status stamp.
        break;
    }

    await this.markProcessed('reloadly', eventId);
    return { received: true };
  }

  private async findGiftCardIssuance(params: {
    customIdentifier?: string;
    transactionId?: number | string;
  }) {
    if (params.customIdentifier) {
      const byCustom = await this.prisma.giftCardIssuance.findUnique({
        where: { customIdentifier: params.customIdentifier },
      });
      if (byCustom) {
        return byCustom;
      }
      // We send order.id as customIdentifier — also try as orderId directly.
      const byOrderId = await this.prisma.giftCardIssuance.findUnique({
        where: { orderId: params.customIdentifier },
      });
      if (byOrderId) {
        return byOrderId;
      }
    }

    const numericId = Number(params.transactionId);
    if (Number.isFinite(numericId)) {
      return this.prisma.giftCardIssuance.findFirst({
        where: { reloadlyTransactionId: BigInt(numericId) },
      });
    }

    return null;
  }
}
