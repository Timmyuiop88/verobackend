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
  /** Covers both PURCHASE and TOPUP orders — check `orderType` on the payload. */
  OrderFailed: 'order.failed',
  TopUpCompleted: 'topup.completed',
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
