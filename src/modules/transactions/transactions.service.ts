import { Injectable } from '@nestjs/common';
import { Prisma, WalletTransactionType } from '@prisma/client';
import {
  buildPaginationMeta,
  PaginationMetaDto,
} from '../../common/dto/pagination.dto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import {
  TransactionCategory,
  type TransactionFeedItemDto,
} from './dto/transaction-feed-item.dto';
import {
  toTransactionFeedItemFromOrder,
  toTransactionFeedItemFromWallet,
  type OrderForFeed,
} from './transactions.mapper';

const ORDER_CATEGORIES: TransactionCategory[] = [
  TransactionCategory.ESIM_PURCHASE,
  TransactionCategory.ESIM_TOPUP,
  TransactionCategory.GIFT_CARD_PURCHASE,
  TransactionCategory.SMS_ONE_TIME,
  TransactionCategory.NUMBER_RENTAL,
];
const WALLET_CATEGORIES: TransactionCategory[] = [
  TransactionCategory.WALLET_DEPOSIT,
  TransactionCategory.WALLET_REFUND,
  TransactionCategory.WALLET_ADJUSTMENT,
];

/**
 * Unified "Transactions" feed over orders (eSIM purchases, eSIM top-ups,
 * gift cards) and wallet ledger entries (deposits, refunds, adjustments) —
 * one merged, filterable, paginated timeline per user, matching the reference UI
 * (date range / type / category / status filters, All/Completed/Pending/Failed tabs).
 *
 * `WalletTransactionType.PURCHASE` rows are deliberately excluded from the
 * wallet side — that spend is already represented by the corresponding Order
 * row, so including both would double-count the same debit.
 *
 * Implementation note: merges two Prisma sources in application code rather
 * than a single SQL UNION. Simple and correct for a per-user history at
 * normal scale; revisit with a windowed SQL UNION if a single user's history
 * ever grows into the tens of thousands of rows.
 */
@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(
    userId: string,
    query: ListTransactionsQueryDto,
  ): Promise<{ data: TransactionFeedItemDto[]; meta: PaginationMetaDto }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const dateFilter: Prisma.DateTimeFilter | undefined =
      query.dateFrom || query.dateTo
        ? {
            ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
            ...(query.dateTo ? { lte: endOfDay(new Date(query.dateTo)) } : {}),
          }
        : undefined;

    const includeOrders =
      !query.category || ORDER_CATEGORIES.includes(query.category);
    const includeWallet =
      !query.category || WALLET_CATEGORIES.includes(query.category);

    const [orders, wallet] = await Promise.all([
      includeOrders
        ? this.prisma.order.findMany({
            where: { userId, ...(dateFilter ? { createdAt: dateFilter } : {}) },
            orderBy: { createdAt: 'desc' },
            include: {
              product: true,
              topUpProduct: true,
              providerOrder: true,
              giftCardDenomination: { include: { product: true } },
              giftCardIssuance: true,
              smsOneTimeOffer: { include: { service: true, country: true } },
              smsVerification: true,
              numberRentalPlan: { include: { rentalSku: true } },
              numberRental: true,
            },
          })
        : Promise.resolve<OrderForFeed[]>([]),
      includeWallet
        ? this.prisma.wallet.findUnique({ where: { userId } })
        : Promise.resolve(null),
    ]);

    const walletTransactions =
      includeWallet && wallet
        ? await this.prisma.walletTransaction.findMany({
            where: {
              walletId: wallet.id,
              type: { not: WalletTransactionType.PURCHASE },
              ...(dateFilter ? { createdAt: dateFilter } : {}),
            },
            orderBy: { createdAt: 'desc' },
          })
        : [];

    let items: TransactionFeedItemDto[] = [
      ...orders.map(toTransactionFeedItemFromOrder),
      ...walletTransactions.map(toTransactionFeedItemFromWallet),
    ];

    if (query.category) {
      items = items.filter((item) => item.category === query.category);
    }
    if (query.type) {
      items = items.filter((item) => item.direction === query.type);
    }
    if (query.status) {
      items = items.filter((item) => item.status === query.status);
    }

    items.sort((a, b) => b.date.getTime() - a.date.getTime());

    const total = items.length;
    const start = (page - 1) * limit;
    const data = items.slice(start, start + limit);

    return { data, meta: buildPaginationMeta(page, limit, total) };
  }
}

function endOfDay(date: Date): Date {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}
