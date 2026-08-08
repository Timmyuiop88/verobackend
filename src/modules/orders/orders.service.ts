import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import {
  OrderStatus,
  ProductStatus,
  type Order,
  type ProviderOrder,
  type User,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  esimBuyDebug,
  esimBuyDebugError,
} from '../../common/debug/esim-buy-debug';
import { PrismaService } from '../../common/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  FULFILL_JOB_ATTEMPTS,
  FULFILL_JOB_BACKOFF_MS,
  FULFILL_JOB_NAME,
  FULFILL_ORDER_QUEUE,
} from '../fulfillment/fulfillment.constants';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import type { EsimInstallDetailsResponseDto } from './dto/install-details-response.dto';
import { toInstallDetailsResponse } from './orders.mapper';

export type OrderWithProvider = Order & { providerOrder: ProviderOrder | null };

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly esimAccess: EsimAccessService,
    private readonly fulfillmentService: FulfillmentService,
    @InjectQueue(FULFILL_ORDER_QUEUE)
    private readonly fulfillQueue: Queue,
  ) {}

  async create(user: User, productId: string): Promise<OrderWithProvider> {
    // TEMP: remove [ESIM_BUY_DEBUG] tracing when purchase flow is stable
    esimBuyDebug('2.lookup.product', { userId: user.id, productId });
    const product = await this.prisma.product.findFirst({
      where: { id: productId, status: ProductStatus.PUBLISHED },
    });
    if (!product) {
      esimBuyDebug('2.lookup.product.miss', { productId });
      throw new NotFoundException('Published product not found');
    }
    esimBuyDebug('2.lookup.product.ok', {
      productId: product.id,
      name: product.name,
      supplierSku: product.supplierSku,
      retailPrice: product.retailPrice.toString(),
      locationCode: product.locationCode,
    });

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        productId: product.id,
        amount: product.retailPrice,
        currency: product.currency,
        status: OrderStatus.PAID,
      },
    });
    esimBuyDebug('3.order.created', {
      orderId: order.id,
      status: order.status,
      amount: order.amount.toString(),
    });

    try {
      esimBuyDebug('4.wallet.debit.start', {
        orderId: order.id,
        userId: user.id,
        amount: product.retailPrice.toString(),
        reference: `purchase_${order.id}`,
      });
      const debitTx = await this.walletService.debit({
        userId: user.id,
        amount: product.retailPrice,
        reference: `purchase_${order.id}`,
        metadata: { orderId: order.id, productId: product.id },
      });
      esimBuyDebug('4.wallet.debit.ok', {
        orderId: order.id,
        txId: debitTx.id,
        balanceAfter: debitTx.balanceAfter.toString(),
      });
    } catch (error) {
      esimBuyDebugError('4.wallet.debit.failed', error, { orderId: order.id });
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.FAILED },
      });
      throw error;
    }

    const fulfilling = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLING },
      include: { providerOrder: true },
    });
    esimBuyDebug('5.order.status.fulfilling', { orderId: order.id });

    await this.fulfillQueue.add(
      FULFILL_JOB_NAME,
      { orderId: order.id },
      {
        jobId: order.id,
        attempts: FULFILL_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: FULFILL_JOB_BACKOFF_MS },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
    esimBuyDebug('6.queue.enqueued', {
      orderId: order.id,
      queue: FULFILL_ORDER_QUEUE,
      jobId: order.id,
    });

    return fulfilling;
  }

  async listForUser(userId: string): Promise<OrderWithProvider[]> {
    return this.prisma.order.findMany({
      where: { userId },
      include: { providerOrder: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getForUser(
    userId: string,
    orderId: string,
  ): Promise<OrderWithProvider> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { providerOrder: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.userId !== userId) {
      throw new ForbiddenException('Order not found');
    }
    return order;
  }

  /**
   * Everything a frontend needs to render the "install your eSIM" screen:
   * QR code, LPA activation code (parsed into SM-DP+ address + matching ID
   * for manual entry), an iOS one-tap universal link, and manual APN/PIN/PUK
   * fallback fields.
   *
   * The provider tends to backfill the richer fields (apn/pin/puk/shortUrl)
   * a short while after initial allocation. If they're still missing when
   * the user views this screen, we do a best-effort live re-query and
   * persist whatever comes back before responding, instead of showing a
   * permanently-incomplete snapshot from the original webhook/poll event.
   */
  async getInstallDetailsForUser(
    userId: string,
    orderId: string,
  ): Promise<EsimInstallDetailsResponseDto> {
    const order = await this.getForUser(userId, orderId);
    if (!order.providerOrder?.iccid) {
      throw new NotFoundException(
        'eSIM not ready yet — check order status first',
      );
    }

    let providerOrder = order.providerOrder;

    if (
      (!providerOrder.apn || !providerOrder.shortUrl) &&
      providerOrder.externalOrderId
    ) {
      try {
        const queried = await this.esimAccess.queryOrder(
          providerOrder.externalOrderId,
        );
        const profile = queried.esimList?.[0];
        if (profile?.iccid) {
          await this.fulfillmentService.completeFromProfile({
            orderId: order.id,
            externalOrderId: providerOrder.externalOrderId,
            profile,
            source: 'manual-refresh',
          });
          providerOrder = await this.prisma.providerOrder.findUniqueOrThrow({
            where: { orderId: order.id },
          });
        }
      } catch {
        // Best-effort — fall back to whatever we already have on file.
      }
    }

    const usage = await this.prisma.esimUsage.findUnique({
      where: { providerOrderId: providerOrder.id },
    });

    return toInstallDetailsResponse(
      order.id,
      providerOrder,
      usage?.expiresAt ?? null,
    );
  }

  async listAll(): Promise<OrderWithProvider[]> {
    return this.prisma.order.findMany({
      include: { providerOrder: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async retryFulfillment(orderId: string): Promise<OrderWithProvider> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { providerOrder: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Never resurrect a terminal financial state. If it's REFUNDED, the
    // customer already has their money back — fulfilling it now for free
    // would be a loss. If COMPLETED, there's nothing to retry.
    if (order.status === OrderStatus.COMPLETED) {
      throw new BadRequestException(
        'Order already completed; nothing to retry',
      );
    }
    if (order.status === OrderStatus.REFUNDED) {
      throw new BadRequestException(
        'Order was refunded; use a wallet adjustment + new order instead of retrying a refunded order',
      );
    }

    await this.prisma.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FULFILLING },
    });

    await this.fulfillQueue.add(
      FULFILL_JOB_NAME,
      { orderId },
      {
        jobId: `${orderId}_retry_${Date.now()}`,
        attempts: FULFILL_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: FULFILL_JOB_BACKOFF_MS },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    return this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { providerOrder: true },
    });
  }
}
