import type {
  GiftCardDenomination,
  GiftCardIssuance,
  GiftCardProduct,
  Order,
  Product,
  ProviderOrder,
  TopUpProduct,
  WalletTransaction,
  WalletTransactionType,
} from '@prisma/client';
import { formatDataVolume, formatUsd } from '../catalog/catalog.mapper';
import {
  TransactionCategory,
  TransactionDirection,
  TransactionFeedStatus,
  type TransactionFeedItemDto,
} from './dto/transaction-feed-item.dto';

export type OrderForFeed = Order & {
  product: Product | null;
  topUpProduct: TopUpProduct | null;
  providerOrder: ProviderOrder | null;
  giftCardDenomination:
    (GiftCardDenomination & { product: GiftCardProduct }) | null;
  giftCardIssuance: GiftCardIssuance | null;
};

function normalizeOrderStatus(status: string): TransactionFeedStatus {
  if (status === 'COMPLETED') return TransactionFeedStatus.COMPLETED;
  if (status === 'FAILED' || status === 'REFUNDED')
    return TransactionFeedStatus.FAILED;
  return TransactionFeedStatus.PENDING;
}

function normalizeWalletStatus(status: string): TransactionFeedStatus {
  if (status === 'COMPLETED') return TransactionFeedStatus.COMPLETED;
  if (status === 'FAILED') return TransactionFeedStatus.FAILED;
  return TransactionFeedStatus.PENDING;
}

function toGiftCardFeedItem(order: OrderForFeed): TransactionFeedItemDto {
  const product = order.giftCardDenomination?.product ?? null;
  const faceValue = order.giftCardDenomination?.faceValue;

  return {
    id: `order:${order.id}`,
    category: TransactionCategory.GIFT_CARD_PURCHASE,
    direction: TransactionDirection.DEBIT,
    title: product?.name ?? 'Gift card',
    subtitle: faceValue ? `${formatUsd(faceValue)} card` : null,
    amount: order.amount.toString(),
    amountDisplay: `-${formatUsd(order.amount)}`,
    currency: order.currency,
    status: normalizeOrderStatus(order.status),
    rawStatus: order.status,
    reference: order.id,
    date: order.createdAt,
    meta: {
      orderId: order.id,
      giftCardDenominationId: order.giftCardDenominationId,
      // Lets the UI deep-link straight to the reveal action, without ever
      // carrying the code itself through the feed.
      codeAvailable: (order.giftCardIssuance?.cardCount ?? 0) > 0,
      failureReason: order.failureReason,
    },
  };
}

export function toTransactionFeedItemFromOrder(
  order: OrderForFeed,
): TransactionFeedItemDto {
  if (order.orderType === 'GIFT_CARD') {
    return toGiftCardFeedItem(order);
  }

  const isTopUp = order.orderType === 'TOPUP';
  const title = isTopUp
    ? (order.topUpProduct?.name ?? 'eSIM top-up')
    : (order.product?.name ?? 'eSIM purchase');
  const dataDisplay = isTopUp
    ? formatDataVolume(order.topUpProduct?.dataVolumeBytes)
    : formatDataVolume(order.product?.dataVolumeBytes);
  const durationDays = isTopUp
    ? order.topUpProduct?.durationDays
    : order.product?.durationDays;
  const subtitle = [dataDisplay, durationDays ? `${durationDays} Days` : null]
    .filter(Boolean)
    .join(' · ');

  return {
    id: `order:${order.id}`,
    category: isTopUp
      ? TransactionCategory.ESIM_TOPUP
      : TransactionCategory.ESIM_PURCHASE,
    direction: TransactionDirection.DEBIT,
    title,
    subtitle: subtitle || null,
    amount: order.amount.toString(),
    amountDisplay: `-${formatUsd(order.amount)}`,
    currency: order.currency,
    status: normalizeOrderStatus(order.status),
    rawStatus: order.status,
    reference: order.id,
    date: order.createdAt,
    meta: {
      orderId: order.id,
      targetEsimId: order.targetProviderOrderId,
      providerOrderId: order.providerOrder?.id ?? null,
      failureReason: order.failureReason,
    },
  };
}

function walletCategory(type: WalletTransactionType): TransactionCategory {
  if (type === 'DEPOSIT') return TransactionCategory.WALLET_DEPOSIT;
  if (type === 'REFUND') return TransactionCategory.WALLET_REFUND;
  return TransactionCategory.WALLET_ADJUSTMENT;
}

function walletTitle(type: WalletTransactionType): string {
  if (type === 'DEPOSIT') return 'Wallet deposit';
  if (type === 'REFUND') return 'Refund';
  return 'Balance adjustment';
}

/**
 * ADJUSTMENT is the only wallet transaction type that can go either way —
 * direction is stamped into `metadata.direction` at creation time (see
 * WalletService.adjust). DEPOSIT/REFUND are always credits by construction.
 * Falls back to 'credit' for any pre-existing rows created before this field
 * existed.
 */
function walletDirection(tx: WalletTransaction): TransactionDirection {
  if (tx.type === 'DEPOSIT' || tx.type === 'REFUND') {
    return TransactionDirection.CREDIT;
  }
  const metadata = tx.metadata as Record<string, unknown> | null;
  return metadata?.direction === 'debit'
    ? TransactionDirection.DEBIT
    : TransactionDirection.CREDIT;
}

export function toTransactionFeedItemFromWallet(
  tx: WalletTransaction,
): TransactionFeedItemDto {
  const direction = walletDirection(tx);
  return {
    id: `wallet:${tx.id}`,
    category: walletCategory(tx.type),
    direction,
    title: walletTitle(tx.type),
    subtitle: null,
    amount: tx.amount.toString(),
    amountDisplay: `${direction === TransactionDirection.CREDIT ? '+' : '-'}${formatUsd(tx.amount)}`,
    currency: 'USD',
    status: normalizeWalletStatus(tx.status),
    rawStatus: tx.status,
    reference: tx.reference,
    date: tx.createdAt,
    meta: { walletTransactionId: tx.id, reference: tx.reference },
  };
}
