import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
  type Wallet,
  type WalletTransaction,
} from '@prisma/client';
import { DomainEvent } from '../../common/events/domain-events';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Merges extra keys into a caller-supplied metadata blob, tolerating
   * non-object InputJsonValue (string/number/array) by discarding it rather
   * than spreading something unsafe.
   */
  private mergeMetadata(
    metadata: Prisma.InputJsonValue | undefined,
    extra: Record<string, Prisma.InputJsonValue>,
  ): Prisma.InputJsonObject {
    const base =
      metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Prisma.InputJsonObject)
        : {};
    return { ...base, ...extra };
  }

  private emitWalletTransaction(
    tx: WalletTransaction,
    userId: string,
    currency: string,
    direction: 'credit' | 'debit' = 'credit',
  ): void {
    this.eventEmitter.emit(DomainEvent.WalletCredited, {
      userId,
      walletTransactionId: tx.id,
      type: tx.type,
      amount: tx.amount.toString(),
      currency,
      reference: tx.reference,
      direction,
    });
  }

  async getByUserId(userId: string): Promise<Wallet> {
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  async getWalletWithTransactions(
    userId: string,
    limit = 20,
  ): Promise<{ wallet: Wallet; transactions: WalletTransaction[] }> {
    const wallet = await this.getByUserId(userId);
    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return { wallet, transactions };
  }

  async credit(params: {
    userId: string;
    amount: Prisma.Decimal | number | string;
    reference: string;
    type?: WalletTransactionType;
    metadata?: Prisma.InputJsonValue;
  }): Promise<WalletTransaction> {
    const amount = new Prisma.Decimal(params.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Credit amount must be positive');
    }

    const existing = await this.prisma.walletTransaction.findUnique({
      where: { reference: params.reference },
    });
    if (existing) {
      return existing;
    }

    const { transaction, currency } = await this.prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId: params.userId },
        });
        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }

        const balanceAfter = wallet.balance.add(amount);
        const updated = await tx.wallet.update({
          where: { id: wallet.id, version: wallet.version },
          data: {
            balance: balanceAfter,
            version: { increment: 1 },
          },
        });

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: updated.id,
            type: params.type ?? WalletTransactionType.DEPOSIT,
            amount,
            balanceAfter,
            reference: params.reference,
            status: WalletTransactionStatus.COMPLETED,
            metadata: params.metadata,
          },
        });
        return { transaction, currency: updated.currency };
      },
    );

    this.emitWalletTransaction(transaction, params.userId, currency, 'credit');
    return transaction;
  }

  async debit(params: {
    userId: string;
    amount: Prisma.Decimal | number | string;
    reference: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<WalletTransaction> {
    const amount = new Prisma.Decimal(params.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('Debit amount must be positive');
    }

    const existing = await this.prisma.walletTransaction.findUnique({
      where: { reference: params.reference },
    });
    if (existing) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.findUnique({
        where: { userId: params.userId },
      });
      if (!wallet) {
        throw new NotFoundException('Wallet not found');
      }
      if (wallet.balance.lt(amount)) {
        throw new BadRequestException('Insufficient wallet balance');
      }

      const balanceAfter = wallet.balance.sub(amount);
      const updated = await tx.wallet.update({
        where: { id: wallet.id, version: wallet.version },
        data: {
          balance: balanceAfter,
          version: { increment: 1 },
        },
      });

      return tx.walletTransaction.create({
        data: {
          walletId: updated.id,
          type: WalletTransactionType.PURCHASE,
          amount,
          balanceAfter,
          reference: params.reference,
          status: WalletTransactionStatus.COMPLETED,
          metadata: params.metadata,
        },
      });
    });
  }

  async refund(params: {
    userId: string;
    amount: Prisma.Decimal | number | string;
    reference: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<WalletTransaction> {
    return this.credit({
      ...params,
      type: WalletTransactionType.REFUND,
    });
  }

  async adjust(params: {
    userId: string;
    amount: Prisma.Decimal | number | string;
    reference: string;
    metadata?: Prisma.InputJsonValue;
  }): Promise<WalletTransaction> {
    const amount = new Prisma.Decimal(params.amount);
    if (amount.eq(0)) {
      throw new BadRequestException('Adjustment amount cannot be zero');
    }

    if (amount.gt(0)) {
      return this.credit({
        ...params,
        type: WalletTransactionType.ADJUSTMENT,
        // Stored (not just emitted) so the transactions feed can read
        // direction straight off WalletTransaction.metadata — ADJUSTMENT is
        // the only type whose sign isn't implied by its `type` alone.
        metadata: this.mergeMetadata(params.metadata, { direction: 'credit' }),
      });
    }

    const existing = await this.prisma.walletTransaction.findUnique({
      where: { reference: params.reference },
    });
    if (existing) {
      return existing;
    }

    const debitAmount = amount.abs();

    const { transaction, currency } = await this.prisma.$transaction(
      async (tx) => {
        const wallet = await tx.wallet.findUnique({
          where: { userId: params.userId },
        });
        if (!wallet) {
          throw new NotFoundException('Wallet not found');
        }
        if (wallet.balance.lt(debitAmount)) {
          throw new BadRequestException('Insufficient wallet balance');
        }

        const balanceAfter = wallet.balance.sub(debitAmount);
        const updated = await tx.wallet.update({
          where: { id: wallet.id, version: wallet.version },
          data: {
            balance: balanceAfter,
            version: { increment: 1 },
          },
        });

        const transaction = await tx.walletTransaction.create({
          data: {
            walletId: updated.id,
            type: WalletTransactionType.ADJUSTMENT,
            amount: debitAmount,
            balanceAfter,
            reference: params.reference,
            status: WalletTransactionStatus.COMPLETED,
            metadata: this.mergeMetadata(params.metadata, {
              direction: 'debit',
            }),
          },
        });
        return { transaction, currency: updated.currency };
      },
    );

    this.emitWalletTransaction(transaction, params.userId, currency, 'debit');
    return transaction;
  }
}
