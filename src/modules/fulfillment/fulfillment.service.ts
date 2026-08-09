import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OrderStatus, ProviderName, type ProviderOrder } from '@prisma/client';
import { esimBuyDebug } from '../../common/debug/esim-buy-debug';
import { DomainEvent } from '../../common/events/domain-events';
import { opsAlert } from '../../common/observability/ops-alert';
import { PrismaService } from '../../common/prisma/prisma.service';
import type {
  EsimProfile,
  EsimTopUpResult,
} from '../integrations/esim-access/esim-access.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import { WalletService } from '../wallet/wallet.service';

/**
 * Single source of truth for order-completion and compensation state
 * transitions. Both the poll queue and the eSIM Access webhook feed into
 * this service so "mark completed" / "refund + fail" / "handle a late
 * fulfillment after refund" logic only lives in one place.
 */
@Injectable()
export class FulfillmentService {
  private readonly logger = new Logger(FulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly esimAccess: EsimAccessService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Persist an allocated eSIM profile and, if the order isn't already in a
   * terminal state, mark it COMPLETED. Idempotent — safe to call from the
   * poll chain and the webhook handler for the same order.
   */
  async completeFromProfile(params: {
    orderId: string;
    externalOrderId: string;
    profile: EsimProfile;
    source: 'poll' | 'webhook' | 'manual-refresh';
  }): Promise<void> {
    const { orderId, externalOrderId, profile, source } = params;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      this.logger.warn(`completeFromProfile: order ${orderId} not found`);
      return;
    }

    const providerOrder = await this.prisma.providerOrder.upsert({
      where: { orderId },
      create: {
        orderId,
        provider: ProviderName.ESIM_ACCESS,
        externalOrderId,
        esimTranNo: profile.esimTranNo || null,
        iccid: profile.iccid,
        lpaCode: profile.ac || null,
        qrCodeUrl: profile.qrCodeUrl || null,
        shortUrl: profile.shortUrl || null,
        apn: profile.apn || null,
        pin: profile.pin || null,
        puk: profile.puk || null,
        activatedAt: profile.activateTime
          ? new Date(profile.activateTime)
          : null,
        status: profile.esimStatus || profile.smdpStatus || null,
        rawResponse: profile,
      },
      update: {
        externalOrderId,
        esimTranNo: profile.esimTranNo || undefined,
        iccid: profile.iccid,
        lpaCode: profile.ac || null,
        qrCodeUrl: profile.qrCodeUrl || null,
        // Only overwrite once the provider actually populates these — an
        // earlier (e.g. webhook) snapshot without them shouldn't blank out
        // values a later query already backfilled.
        shortUrl: profile.shortUrl || undefined,
        apn: profile.apn || undefined,
        pin: profile.pin || undefined,
        puk: profile.puk || undefined,
        activatedAt: profile.activateTime
          ? new Date(profile.activateTime)
          : undefined,
        status: profile.esimStatus || profile.smdpStatus || undefined,
        rawResponse: profile,
      },
    });

    await this.prisma.esimUsage.upsert({
      where: { providerOrderId: providerOrder.id },
      create: {
        providerOrderId: providerOrder.id,
        dataUsedBytes: BigInt(profile.orderUsage ?? 0),
        dataTotalBytes:
          profile.totalVolume !== undefined
            ? BigInt(profile.totalVolume)
            : null,
        expiresAt: profile.expiredTime ? new Date(profile.expiredTime) : null,
        lastSyncedAt: new Date(),
      },
      update: {
        dataUsedBytes:
          profile.orderUsage !== undefined
            ? BigInt(profile.orderUsage)
            : undefined,
        dataTotalBytes:
          profile.totalVolume !== undefined
            ? BigInt(profile.totalVolume)
            : undefined,
        expiresAt: profile.expiredTime
          ? new Date(profile.expiredTime)
          : undefined,
        lastSyncedAt: new Date(),
      },
    });

    if (order.status === OrderStatus.REFUNDED) {
      await this.handleLateFulfillment({
        orderId,
        providerOrder,
        profile,
        source,
      });
      return;
    }

    if (order.status === OrderStatus.COMPLETED) {
      return;
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.COMPLETED },
    });
    esimBuyDebug('fulfillment.order.completed', {
      orderId,
      source,
      iccid: profile.iccid,
    });

    const product = order.productId
      ? await this.prisma.product.findUnique({
          where: { id: order.productId },
          select: { name: true },
        })
      : null;

    this.eventEmitter.emit(DomainEvent.OrderCompleted, {
      orderId,
      userId: order.userId,
      orderType: order.orderType,
      amount: order.amount.toString(),
      currency: order.currency,
      productName: product?.name ?? null,
      iccid: profile.iccid,
    });
  }

  /**
   * Persist the result of a successful `/esim/topup` call: refresh the
   * target eSIM's usage snapshot (new total volume / expiry from the
   * provider's response) and mark the TOPUP order COMPLETED. Idempotent —
   * safe to call once per successful provider response only (the top-up
   * queue guarantees at-most-one success per order since the provider call
   * itself is not retried once it succeeds).
   */
  async completeTopUp(params: {
    topUpOrderId: string;
    providerOrderId: string;
    result: EsimTopUpResult;
  }): Promise<void> {
    const { topUpOrderId, providerOrderId, result } = params;

    const order = await this.prisma.order.findUnique({
      where: { id: topUpOrderId },
    });
    if (!order) {
      this.logger.warn(`completeTopUp: order ${topUpOrderId} not found`);
      return;
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      return;
    }

    await this.prisma.esimUsage.upsert({
      where: { providerOrderId },
      create: {
        providerOrderId,
        dataUsedBytes: BigInt(result.orderUsage ?? 0),
        dataTotalBytes:
          result.totalVolume !== undefined ? BigInt(result.totalVolume) : null,
        expiresAt: result.expiredTime ? new Date(result.expiredTime) : null,
        lastSyncedAt: new Date(),
      },
      update: {
        dataUsedBytes:
          result.orderUsage !== undefined
            ? BigInt(result.orderUsage)
            : undefined,
        dataTotalBytes:
          result.totalVolume !== undefined
            ? BigInt(result.totalVolume)
            : undefined,
        expiresAt: result.expiredTime
          ? new Date(result.expiredTime)
          : undefined,
        lastSyncedAt: new Date(),
      },
    });

    await this.prisma.order.update({
      where: { id: topUpOrderId },
      data: { status: OrderStatus.COMPLETED },
    });

    esimBuyDebug('fulfillment.topup.completed', {
      topUpOrderId,
      providerOrderId,
      iccid: result.iccid,
    });

    this.eventEmitter.emit(DomainEvent.TopUpCompleted, {
      orderId: topUpOrderId,
      userId: order.userId,
      providerOrderId,
      amount: order.amount.toString(),
      currency: order.currency,
      iccid: result.iccid,
    });
  }

  /**
   * Mark an order FAILED, refund the wallet (idempotent via the
   * `refund_${orderId}` reference), then mark it REFUNDED. No-ops if the
   * order is already terminal (COMPLETED/REFUNDED) so it's safe to call
   * from multiple retry paths.
   */
  async refundAndFail(orderId: string, reason: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) {
      this.logger.warn(`refundAndFail: order ${orderId} not found`);
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
      data: { status: OrderStatus.FAILED, failureReason: reason },
    });

    await this.walletService.refund({
      userId: order.userId,
      amount: order.amount,
      reference: `refund_${order.id}`,
      metadata: { orderId: order.id, reason },
    });

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.REFUNDED },
    });

    opsAlert('order_auto_refunded', {
      orderId,
      reason,
      amount: order.amount.toString(),
    });

    this.eventEmitter.emit(DomainEvent.OrderFailed, {
      orderId,
      userId: order.userId,
      orderType: order.orderType,
      amount: order.amount.toString(),
      currency: order.currency,
      reason,
    });
  }

  /**
   * A profile arrived after we already refunded the customer (e.g. poll
   * exhaustion raced a slow provider allocation, or webhook + reconciliation
   * both eventually succeeded). We keep the order REFUNDED — the customer
   * already got their money back — but must not leave a live, usable eSIM
   * unaccounted for. Try a refundable cancel first, fall back to a
   * non-refundable revoke, and always alert ops either way.
   */
  private async handleLateFulfillment(params: {
    orderId: string;
    providerOrder: ProviderOrder;
    profile: EsimProfile;
    source: string;
  }): Promise<void> {
    const { orderId, providerOrder, profile, source } = params;

    opsAlert('late_fulfillment_after_refund', {
      orderId,
      externalOrderId: providerOrder.externalOrderId,
      esimTranNo: profile.esimTranNo,
      iccid: profile.iccid,
      source,
    });

    if (!profile.esimTranNo) {
      opsAlert('late_fulfillment_cleanup_skipped_no_esim_tran_no', { orderId });
      return;
    }

    try {
      await this.esimAccess.cancelEsim(profile.esimTranNo);
      await this.prisma.providerOrder.update({
        where: { id: providerOrder.id },
        data: { status: 'CANCELLED_AFTER_REFUND' },
      });
      return;
    } catch (cancelError) {
      this.logger.warn(
        `Cancel failed for late-fulfilled eSIM ${profile.esimTranNo} (order ${orderId}), attempting revoke`,
        cancelError as Error,
      );
    }

    try {
      await this.esimAccess.revokeEsim(profile.esimTranNo);
      await this.prisma.providerOrder.update({
        where: { id: providerOrder.id },
        data: { status: 'REVOKED_AFTER_REFUND' },
      });
    } catch (revokeError) {
      opsAlert('late_fulfillment_cleanup_failed', {
        orderId,
        esimTranNo: profile.esimTranNo,
        error: (revokeError as Error).message,
      });
    }
  }
}
