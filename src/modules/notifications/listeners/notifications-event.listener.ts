import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { NotificationType, OrderType } from '@prisma/client';
import {
  DomainEvent,
  type GiftCardIssuedPayload,
  type OrderCompletedPayload,
  type OrderFailedPayload,
  type RentalReadyPayload,
  type RentalSmsReceivedPayload,
  type SmsCodeReceivedPayload,
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

/** Narrow helper — keeps string literals working even if the IDE's Prisma cache is stale. */
function asNotificationType(value: string): NotificationType {
  return value as NotificationType;
}

function failedNotificationType(orderType: OrderType): NotificationType {
  switch (orderType as string) {
    case 'GIFT_CARD':
      return asNotificationType('GIFT_CARD_FAILED');
    case 'SMS_ONE_TIME':
      return asNotificationType('SMS_ORDER_FAILED');
    case 'NUMBER_RENTAL':
    case 'NUMBER_RENTAL_EXTEND':
      return asNotificationType('RENTAL_FAILED');
    default:
      return asNotificationType('ORDER_FAILED');
  }
}

function failedNotificationTitle(orderType: OrderType): string {
  switch (orderType as string) {
    case 'TOPUP':
      return 'Top-up failed — refunded';
    case 'GIFT_CARD':
      return 'Gift card purchase failed — refunded';
    case 'SMS_ONE_TIME':
      return 'SMS verification failed — refunded';
    case 'NUMBER_RENTAL':
      return 'Number rental failed — refunded';
    case 'NUMBER_RENTAL_EXTEND':
      return 'Rental extension failed — refunded';
    default:
      return 'Purchase failed — refunded';
  }
}

/**
 * Turns domain events into in-app Notification rows. Runs independently of
 * EmailEventListener — disabling/failing one never affects the other.
 *
 * Incoming SMS creates notifications via:
 * - `SmsCodeReceived` → SMS_CODE_RECEIVED (one-time verification)
 * - `RentalSmsReceived` → RENTAL_SMS_RECEIVED (rental inbox)
 */
@Injectable()
export class NotificationsEventListener {
  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent(DomainEvent.WalletCredited)
  async onWalletCredited(payload: WalletCreditedPayload): Promise<void> {
    if (payload.direction === 'debit') {
      await this.notificationsService.create({
        userId: payload.userId,
        type: asNotificationType('WALLET_ADJUSTMENT'),
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
        type: asNotificationType('WALLET_DEPOSIT'),
      },
      REFUND: {
        title: 'Refund received',
        message: `You were refunded ${formatUsd(payload.amount)}.`,
        type: asNotificationType('WALLET_REFUND'),
      },
      ADJUSTMENT: {
        title: 'Wallet adjusted',
        message: `Your wallet was credited ${formatUsd(payload.amount)} by support.`,
        type: asNotificationType('WALLET_ADJUSTMENT'),
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
      type: asNotificationType('ORDER_COMPLETED'),
      title: 'Your eSIM is ready',
      message: `${payload.productName ?? 'Your eSIM'} is ready to install.`,
      data: { orderId: payload.orderId, iccid: payload.iccid },
    });
  }

  @OnEvent(DomainEvent.OrderFailed)
  async onOrderFailed(payload: OrderFailedPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: failedNotificationType(payload.orderType),
      title: failedNotificationTitle(payload.orderType),
      message: `${humanizeFailureReason(payload.reason)}. You've been refunded ${formatUsd(payload.amount)}.`,
      data: { orderId: payload.orderId, reason: payload.reason },
    });
  }

  @OnEvent(DomainEvent.GiftCardIssued)
  async onGiftCardIssued(payload: GiftCardIssuedPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: asNotificationType('GIFT_CARD_READY'),
      title: 'Your gift card is ready',
      message: `${payload.productName} (${formatUsd(payload.faceValue)}) has been issued. Tap to view your code.`,
      data: { orderId: payload.orderId, cardCount: payload.cardCount },
    });
  }

  @OnEvent(DomainEvent.SmsCodeReceived)
  async onSmsCodeReceived(payload: SmsCodeReceivedPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: asNotificationType('SMS_CODE_RECEIVED'),
      title: 'SMS code received',
      message: payload.smsCode
        ? `Your verification code is ${payload.smsCode}.`
        : 'An SMS arrived on your verification number.',
      data: {
        orderId: payload.orderId,
        phoneNumber: payload.phoneNumber,
      },
    });
  }

  @OnEvent(DomainEvent.RentalReady)
  async onRentalReady(payload: RentalReadyPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: asNotificationType('RENTAL_READY'),
      title: 'Number rental ready',
      message: payload.phoneNumber
        ? `Your number ${payload.phoneNumber} is active.`
        : 'Your rented number is active.',
      data: {
        orderId: payload.orderId,
        rentalId: payload.rentalId,
        expiresAt: payload.expiresAt,
      },
    });
  }

  @OnEvent(DomainEvent.RentalSmsReceived)
  async onRentalSmsReceived(payload: RentalSmsReceivedPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: asNotificationType('RENTAL_SMS_RECEIVED'),
      title: 'New SMS on rented number',
      message: payload.smsCode
        ? `Code ${payload.smsCode} arrived on ${payload.phoneNumber ?? 'your number'}.`
        : `New message on ${payload.phoneNumber ?? 'your rented number'}.`,
      data: {
        orderId: payload.orderId,
        rentalId: payload.rentalId,
      },
    });
  }

  @OnEvent(DomainEvent.TopUpCompleted)
  async onTopUpCompleted(payload: TopUpCompletedPayload): Promise<void> {
    await this.notificationsService.create({
      userId: payload.userId,
      type: asNotificationType('TOPUP_COMPLETED'),
      title: 'Top-up successful',
      message: `Your eSIM was topped up for ${formatUsd(payload.amount)}.`,
      data: {
        orderId: payload.orderId,
        providerOrderId: payload.providerOrderId,
      },
    });
  }
}
