import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  WalletTransactionStatus,
  WalletTransactionType,
  type Wallet,
  type WalletTransaction,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

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

    return this.prisma.$transaction(async (tx) => {
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

      return tx.walletTransaction.create({
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
    });
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
      });
    }

    const existing = await this.prisma.walletTransaction.findUnique({
      where: { reference: params.reference },
    });
    if (existing) {
      return existing;
    }

    const debitAmount = amount.abs();

    return this.prisma.$transaction(async (tx) => {
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

      return tx.walletTransaction.create({
        data: {
          walletId: updated.id,
          type: WalletTransactionType.ADJUSTMENT,
          amount: debitAmount,
          balanceAfter,
          reference: params.reference,
          status: WalletTransactionStatus.COMPLETED,
          metadata: params.metadata,
        },
      });
    });
  }
}
