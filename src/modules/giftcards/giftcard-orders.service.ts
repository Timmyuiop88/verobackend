import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  GiftCardIssuanceStatus,
  OrderStatus,
  OrderType,
  Prisma,
  type GiftCardDenomination,
  type GiftCardIssuance,
  type GiftCardProduct,
  type Order,
  type User,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { GiftCardCatalogService } from './giftcard-catalog.service';
import {
  GiftCardFulfillmentService,
  type DecryptedCard,
} from './giftcard-fulfillment.service';
import {
  GIFTCARD_FULFILL_JOB_ATTEMPTS,
  GIFTCARD_FULFILL_JOB_BACKOFF_MS,
  GIFTCARD_FULFILL_JOB_NAME,
  GIFTCARD_FULFILL_QUEUE,
} from './giftcards.constants';

export type GiftCardOrderWithDetail = Order & {
  giftCardIssuance: GiftCardIssuance | null;
  giftCardDenomination:
    (GiftCardDenomination & { product: GiftCardProduct }) | null;
};

const DETAIL_INCLUDE = {
  giftCardIssuance: true,
  giftCardDenomination: { include: { product: true } },
} as const;

@Injectable()
export class GiftCardOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly catalog: GiftCardCatalogService,
    private readonly fulfillment: GiftCardFulfillmentService,
    @InjectQueue(GIFTCARD_FULFILL_QUEUE)
    private readonly fulfillQueue: Queue,
  ) {}

  /**
   * Wallet-first, matching the eSIM purchase flow: debit immediately, then
   * hand the provider call to a queue. The issuance row is created up front
   * so its `customIdentifier` (the order id) exists before any money moves —
   * that identifier is what makes the Reloadly call safely repeatable.
   */
  async create(
    user: User,
    params: {
      denominationId: string;
      recipientEmail?: string;
      externalUserId?: string;
    },
  ): Promise<GiftCardOrderWithDetail> {
    const denomination = await this.catalog.getPurchasableDenomination(
      params.denominationId,
    );

    if (denomination.product.userIdRequired && !params.externalUserId) {
      throw new BadRequestException(
        `${denomination.product.name} requires a game/account user ID — pass \`externalUserId\``,
      );
    }

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        orderType: OrderType.GIFT_CARD,
        giftCardDenominationId: denomination.id,
        amount: denomination.retailPrice,
        currency: denomination.currency,
        status: OrderStatus.PAID,
      },
    });

    await this.prisma.giftCardIssuance.create({
      data: {
        orderId: order.id,
        customIdentifier: order.id,
        productExternalId: denomination.product.externalProductId,
        quantity: 1,
        unitPrice: denomination.faceValue,
        providerStatus: GiftCardIssuanceStatus.PENDING,
      },
    });

    try {
      await this.walletService.debit({
        userId: user.id,
        amount: denomination.retailPrice,
        reference: `purchase_${order.id}`,
        metadata: {
          orderId: order.id,
          giftCardDenominationId: denomination.id,
          giftCardProductId: denomination.productId,
        },
      });
    } catch (error) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.FAILED,
          failureReason: 'wallet_debit_failed',
        },
      });
      throw error;
    }

    const fulfilling = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLING },
      include: DETAIL_INCLUDE,
    });

    await this.fulfillQueue.add(
      GIFTCARD_FULFILL_JOB_NAME,
      {
        orderId: order.id,
        recipientEmail: params.recipientEmail,
        externalUserId: params.externalUserId,
      },
      {
        jobId: order.id,
        attempts: GIFTCARD_FULFILL_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: GIFTCARD_FULFILL_JOB_BACKOFF_MS,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    return fulfilling;
  }

  listForUser(userId: string): Promise<GiftCardOrderWithDetail[]> {
    return this.prisma.order.findMany({
      where: { userId, orderType: OrderType.GIFT_CARD },
      orderBy: { createdAt: 'desc' },
      include: DETAIL_INCLUDE,
    });
  }

  async getForUser(
    userId: string,
    orderId: string,
  ): Promise<GiftCardOrderWithDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: DETAIL_INCLUDE,
    });
    if (!order || order.orderType !== OrderType.GIFT_CARD) {
      throw new NotFoundException('Gift card order not found');
    }
    if (order.userId !== userId) {
      throw new ForbiddenException('Order belongs to another user');
    }
    return order;
  }

  /**
   * The only path that returns card codes. Every call is counted and
   * timestamped so a leaked account shows up in the audit trail, and the
   * controller rate-limits it separately from the global throttle.
   */
  async reveal(
    userId: string,
    orderId: string,
  ): Promise<{ order: GiftCardOrderWithDetail; cards: DecryptedCard[] }> {
    const order = await this.getForUser(userId, orderId);

    if (order.status !== OrderStatus.COMPLETED || !order.giftCardIssuance) {
      throw new BadRequestException(
        'Gift card is not ready yet — this order has not completed',
      );
    }
    if (!order.giftCardIssuance.cardsEncrypted) {
      throw new NotFoundException(
        'No card code is stored for this order yet — please retry shortly',
      );
    }

    const cards = this.fulfillment.decryptCards(order.giftCardIssuance);

    await this.prisma.giftCardIssuance.update({
      where: { id: order.giftCardIssuance.id },
      data: { revealedAt: new Date(), revealCount: { increment: 1 } },
    });

    return { order, cards };
  }

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  listAll(limit = 100): Promise<GiftCardOrderWithDetail[]> {
    return this.prisma.order.findMany({
      where: { orderType: OrderType.GIFT_CARD },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: DETAIL_INCLUDE,
    });
  }

  async retryFulfillment(orderId: string): Promise<GiftCardOrderWithDetail> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: DETAIL_INCLUDE,
    });
    if (!order || order.orderType !== OrderType.GIFT_CARD) {
      throw new NotFoundException('Gift card order not found');
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      throw new BadRequestException(
        `Order is already ${order.status} — nothing to retry`,
      );
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FULFILLING },
    });

    await this.fulfillQueue.add(
      GIFTCARD_FULFILL_JOB_NAME,
      { orderId },
      {
        // A distinct job id — BullMQ refuses to re-add a completed job under
        // the id the original run used.
        jobId: `${orderId}:retry:${Date.now()}`,
        attempts: GIFTCARD_FULFILL_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: GIFTCARD_FULFILL_JOB_BACKOFF_MS,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: DETAIL_INCLUDE,
    });
  }

  /**
   * Realized margin across issued gift cards. Reads from the provider's own
   * transaction figures rather than catalog prices, which is the only way to
   * see what a sale actually earned after Reloadly's fees and commission.
   */
  async marginReport(params: { from?: Date; to?: Date }): Promise<{
    orders: number;
    revenue: string;
    cost: string;
    margin: string;
    marginPercent: string;
    negativeMarginOrders: number;
  }> {
    const issuances = await this.prisma.giftCardIssuance.findMany({
      where: {
        providerStatus: GiftCardIssuanceStatus.SUCCESSFUL,
        ...(params.from || params.to
          ? {
              createdAt: {
                ...(params.from ? { gte: params.from } : {}),
                ...(params.to ? { lte: params.to } : {}),
              },
            }
          : {}),
      },
      include: { order: { select: { amount: true } } },
    });

    let revenue = new Prisma.Decimal(0);
    let margin = new Prisma.Decimal(0);
    let negativeMarginOrders = 0;

    for (const issuance of issuances) {
      revenue = revenue.add(issuance.order.amount);
      if (issuance.realizedMargin) {
        margin = margin.add(issuance.realizedMargin);
        if (issuance.realizedMargin.lte(0)) {
          negativeMarginOrders += 1;
        }
      }
    }

    const cost = revenue.sub(margin);
    return {
      orders: issuances.length,
      revenue: revenue.toFixed(2),
      cost: cost.toFixed(2),
      margin: margin.toFixed(2),
      marginPercent: revenue.gt(0)
        ? margin.div(revenue).mul(100).toFixed(2)
        : '0.00',
      negativeMarginOrders,
    };
  }
}
