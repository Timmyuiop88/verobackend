import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationType } from '@prisma/client';
import {
  DomainEvent,
  type OrderCompletedPayload,
  type OrderFailedPayload,
  type TopUpCompletedPayload,
  type WalletCreditedPayload,
} from '../../../common/events/domain-events';
import { humanizeFailureReason } from '../../../common/events/humanize-failure-reason';
import { NotificationsService } from '../notifications.service';

function formatUsd(amount: string): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

/**
 * Turns domain events into in-app Notification rows. Runs independently of
 * EmailEventListener — disabling/failing one never affects the other.
 */
@Injectable()
export class NotificationsEventListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(DomainEvent.WalletCredited)
  async onWalletCredited(payload: WalletCreditedPayload): Promise<void> {
    if (payload.direction === 'debit') {
      // Only ADJUSTMENT (a support-initiated debit) ever takes this path —
      // DEPOSIT/REFUND are always credits by construction.
      await this.notificationsService.create({
        userId: payload.userId,
        type: NotificationType.WALLET_ADJUSTMENT,
        title: 'Wallet adjusted',
        message: `${formatUsd(payload.amount)} was deducted from your wallet by support.`,
        data: {
          walletTransactionId: payload.walletTransactionId,
          reference: payload.reference,
        },
      });
      return;
    }

    const copy: Record<
      string,
      { title: string; message: string; type: NotificationType }
    > = {
      DEPOSIT: {
        title: 'Deposit successful',
        message: `Your wallet was credited ${formatUsd(payload.amount)}.`,
        type: NotificationType.WALLET_DEPOSIT,
      },
      REFUND: {
        title: 'Refund received',
        message: `You were refunded ${formatUsd(payload.amount)}.`,
        type: NotificationType.WALLET_REFUND,
      },
      ADJUSTMENT: {
        title: 'Wallet adjusted',
        message: `Your wallet was credited ${formatUsd(payload.amount)} by support.`,
        type: NotificationType.WALLET_ADJUSTMENT,
      },
    };
    const entry = copy[payload.type] ?? copy.ADJUSTMENT;

    await this.notificationsService.create({
      userId: payload.userId,
      type: entry.type,
      title: entry.title,
      message: entry.message,
      data: {
        walletTransactionId: payload.walletTransactionId,
        reference: payload.reference,
      },
    });
  }

  @OnEvent(DomainEvent.OrderCompleted)
  async onOrderCompleted(payload: OrderCompletedPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: NotificationType.ORDER_COMPLETED,
      title: 'Your eSIM is ready',
      message: `${payload.productName ?? 'Your eSIM'} is ready to install.`,
      data: { orderId: payload.orderId, iccid: payload.iccid },
    });
  }

  @OnEvent(DomainEvent.OrderFailed)
  async onOrderFailed(payload: OrderFailedPayload): Promise<void> {
    const isTopUp = payload.orderType === 'TOPUP';
    await this.notificationsService.create({
      userId: payload.userId,
      type: NotificationType.ORDER_FAILED,
      title: isTopUp
        ? 'Top-up failed — refunded'
        : 'Purchase failed — refunded',
      message: `${humanizeFailureReason(payload.reason)}. You've been refunded ${formatUsd(payload.amount)}.`,
      data: { orderId: payload.orderId, reason: payload.reason },
    });
  }

  @OnEvent(DomainEvent.TopUpCompleted)
  async onTopUpCompleted(payload: TopUpCompletedPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: NotificationType.TOPUP_COMPLETED,
      title: 'Top-up successful',
      message: `Your eSIM was topped up for ${formatUsd(payload.amount)}.`,
      data: {
        orderId: payload.orderId,
        providerOrderId: payload.providerOrderId,
      },
    });
  }
}
