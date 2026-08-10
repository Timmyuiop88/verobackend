import type { OrderType, WalletTransactionType } from '@prisma/client';

/**
 * Central catalog of "things happened" events. Business services (wallet,
 * fulfillment) emit these; they don't know or care who's listening.
 * NotificationsListener turns them into in-app Notification rows,
 * EmailListener turns them into emails — each independently, so disabling
 * email (EMAIL_ENABLED=false) never affects in-app notifications and vice
 * versa. Add a new event here + a new `case` in each listener to wire up a
 * new kind of user-facing update.
 */
export const DomainEvent = {
  WalletCredited: 'wallet.credited',
  OrderCompleted: 'order.completed',
  /** Covers PURCHASE, TOPUP, GIFT_CARD and SMS orders — check `orderType` on the payload. */
  OrderFailed: 'order.failed',
  TopUpCompleted: 'topup.completed',
  GiftCardIssued: 'giftcard.issued',
  SmsCodeReceived: 'sms.code_received',
  RentalReady: 'sms.rental_ready',
  RentalSmsReceived: 'sms.rental_sms_received',
} as const;

export interface WalletCreditedPayload {
  userId: string;
  walletTransactionId: string;
  type: WalletTransactionType;
  amount: string;
  currency: string;
  reference: string;
  /** Only meaningful for ADJUSTMENT — DEPOSIT/REFUND are always credits. */
  direction: 'credit' | 'debit';
}

export interface OrderCompletedPayload {
  orderId: string;
  userId: string;
  orderType: OrderType;
  amount: string;
  currency: string;
  productName: string | null;
  iccid: string | null;
}

export interface OrderFailedPayload {
  orderId: string;
  userId: string;
  orderType: OrderType;
  amount: string;
  currency: string;
  reason: string;
}

export interface TopUpCompletedPayload {
  orderId: string;
  userId: string;
  providerOrderId: string;
  amount: string;
  currency: string;
  iccid: string | null;
}

/**
 * Deliberately carries no card number or PIN. Codes are bearer secrets and
 * only ever leave the database through the authenticated reveal endpoint,
 * so notifications and emails link to the app instead of embedding them.
 */
export interface GiftCardIssuedPayload {
  orderId: string;
  userId: string;
  amount: string;
  currency: string;
  productName: string;
  faceValue: string;
  cardCount: number;
}

export interface SmsCodeReceivedPayload {
  orderId: string;
  userId: string;
  phoneNumber: string | null;
  smsCode: string | null;
}

export interface RentalReadyPayload {
  orderId: string;
  userId: string;
  rentalId: string;
  phoneNumber: string | null;
  expiresAt: string | null;
}

export interface RentalSmsReceivedPayload {
  orderId: string;
  userId: string;
  rentalId: string;
  phoneNumber: string | null;
  fullSms: string;
  smsCode: string | null;
}
