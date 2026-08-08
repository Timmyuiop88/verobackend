import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, OrderType, ProductStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import {
  esimBuyDebug,
  esimBuyDebugError,
} from '../../common/debug/esim-buy-debug';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TopUpCatalogService } from '../catalog/topup-catalog.service';
import {
  TOPUP_JOB_ATTEMPTS,
  TOPUP_JOB_BACKOFF_MS,
  TOPUP_JOB_NAME,
  TOPUP_ORDER_QUEUE,
} from '../fulfillment/fulfillment.constants';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import type { OrderResponseDto } from '../orders/dto/order-response.dto';
import { toOrderResponse } from '../orders/orders.mapper';
import { WalletService } from '../wallet/wallet.service';
import type { EsimAssetResponseDto } from './dto/esim-asset-response.dto';
import type { TopUpPackageResponseDto } from './dto/topup-package-response.dto';
import {
  toEsimAssetResponse,
  toTopUpPackageResponse,
  type ProviderOrderWithOrder,
} from './esims.mapper';

@Injectable()
export class EsimsService {
  private readonly logger = new Logger(EsimsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
    private readonly topUpCatalogService: TopUpCatalogService,
    private readonly walletService: WalletService,
    @InjectQueue(TOPUP_ORDER_QUEUE)
    private readonly topupQueue: Queue,
  ) {}

  /** Ownership-checked lookup of the eSIM (ProviderOrder) + its originating order/product. */
  private async getOwned(
    userId: string,
    providerOrderId: string,
  ): Promise<ProviderOrderWithOrder> {
    const providerOrder = await this.prisma.providerOrder.findUnique({
      where: { id: providerOrderId },
      include: { order: { include: { product: true } } },
    });
    if (!providerOrder) {
      throw new NotFoundException('eSIM not found');
    }
    if (providerOrder.order.userId !== userId) {
      throw new ForbiddenException('eSIM not found');
    }
    return providerOrder;
  }

  async listAssetsForUser(userId: string): Promise<EsimAssetResponseDto[]> {
    const providerOrders = await this.prisma.providerOrder.findMany({
      where: { order: { userId, orderType: OrderType.PURCHASE } },
      include: { order: { include: { product: true } }, usage: true },
      orderBy: { createdAt: 'desc' },
    });
    return providerOrders.map((po) => toEsimAssetResponse(po, po.usage));
  }

  async getAssetForUser(
    userId: string,
    providerOrderId: string,
  ): Promise<EsimAssetResponseDto> {
    const providerOrder = await this.getOwned(userId, providerOrderId);
    const usage = await this.prisma.esimUsage.findUnique({
      where: { providerOrderId: providerOrder.id },
    });
    return toEsimAssetResponse(providerOrder, usage);
  }

  async listTopUpsForUser(
    userId: string,
    providerOrderId: string,
  ): Promise<OrderResponseDto[]> {
    await this.getOwned(userId, providerOrderId);
    const orders = await this.prisma.order.findMany({
      where: {
        targetProviderOrderId: providerOrderId,
        orderType: OrderType.TOPUP,
      },
      include: { providerOrder: true },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map(toOrderResponse);
  }

  /**
   * Admin-curated, DB-driven top-up catalog for this eSIM's product — no
   * live provider call here (see TopUpCatalogService.listPublishedForProduct).
   * The exact packageCode chosen here is re-validated live against the
   * provider right before charging in `createTopUp`.
   */
  async listTopUpPackagesForUser(
    userId: string,
    providerOrderId: string,
  ): Promise<TopUpPackageResponseDto[]> {
    const providerOrder = await this.getOwned(userId, providerOrderId);
    if (!providerOrder.iccid) {
      throw new BadRequestException(
        'eSIM not ready yet — check its status first',
      );
    }

    const topUps = await this.topUpCatalogService.listPublishedForProduct(
      providerOrder.order.productId,
    );
    return topUps.map(toTopUpPackageResponse);
  }

  /**
   * Charge the wallet and queue a top-up against an existing eSIM. Mirrors
   * OrdersService.create's create → debit → enqueue shape, plus top-up-
   * specific safety checks that a fresh purchase doesn't need:
   *
   * 1. The chosen package must be a PUBLISHED, admin-approved TopUpProduct
   *    for this eSIM's product, with `topUpEnabled` on — the price charged
   *    is the stored/approved retail price, never a client-supplied or
   *    live-quoted one.
   * 2. A final live check against the provider (by iccid) that this exact
   *    packageCode is still offered for this specific eSIM right now —
   *    catalog approval controls *what's for sale*, not final per-instance
   *    eligibility (validity window, top-up cap, suspension, etc.).
   * 3. A Postgres advisory lock scoped to this eSIM's id, held for the
   *    duration of the "any top-up already in flight?" check + order
   *    creation, so two near-simultaneous requests (double-click, retried
   *    request) can't both pass the check and double-charge the same asset.
   */
  async createTopUp(
    userId: string,
    providerOrderId: string,
    packageCode: string,
  ): Promise<OrderResponseDto> {
    const providerOrder = await this.getOwned(userId, providerOrderId);
    const iccid = providerOrder.iccid;
    if (!iccid) {
      throw new BadRequestException(
        'eSIM not ready yet — check its status first',
      );
    }
    if (!providerOrder.order.product?.topUpEnabled) {
      throw new BadRequestException('Top-ups are not enabled for this eSIM');
    }

    esimBuyDebug('topup.request.received', {
      userId,
      providerOrderId,
      packageCode,
    });

    const topUpProduct = await this.prisma.topUpProduct.findUnique({
      where: {
        productId_packageCode: {
          productId: providerOrder.order.productId!,
          packageCode,
        },
      },
    });
    if (!topUpProduct || topUpProduct.status !== ProductStatus.PUBLISHED) {
      throw new BadRequestException(
        'Top-up package not available for this eSIM',
      );
    }

    const livePackages = await this.esimAccess.listTopUpPackagesByIccid(iccid);
    const stillEligible = livePackages.some(
      (p) => p.packageCode === packageCode,
    );
    if (!stillEligible) {
      throw new BadRequestException(
        'This eSIM is not eligible for that top-up right now — refresh and try again',
      );
    }

    const retailPrice = topUpProduct.retailPrice;

    const order = await this.prisma.$transaction(async (tx) => {
      // Serializes concurrent attempts against this exact eSIM. Held only
      // for this transaction's lifetime, released automatically on commit
      // or rollback — never blocks top-ups against other eSIMs.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${providerOrderId}))`;

      const inFlight = await tx.order.findFirst({
        where: {
          targetProviderOrderId: providerOrderId,
          orderType: OrderType.TOPUP,
          status: { in: [OrderStatus.PAID, OrderStatus.FULFILLING] },
        },
      });
      if (inFlight) {
        throw new ConflictException(
          'A top-up is already in progress for this eSIM',
        );
      }

      return tx.order.create({
        data: {
          userId,
          orderType: OrderType.TOPUP,
          targetProviderOrderId: providerOrderId,
          topUpProductId: topUpProduct.id,
          amount: retailPrice,
          currency: 'USD',
          status: OrderStatus.PAID,
        },
      });
    });

    esimBuyDebug('topup.order.created', {
      orderId: order.id,
      providerOrderId,
      amount: order.amount.toString(),
    });

    try {
      await this.walletService.debit({
        userId,
        amount: retailPrice,
        reference: `topup_${order.id}`,
        metadata: { orderId: order.id, providerOrderId, packageCode },
      });
    } catch (error) {
      esimBuyDebugError('topup.wallet.debit.failed', error, {
        orderId: order.id,
      });
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

    await this.topupQueue.add(
      TOPUP_JOB_NAME,
      { orderId: order.id, providerOrderId, iccid, packageCode },
      {
        jobId: order.id,
        attempts: TOPUP_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: TOPUP_JOB_BACKOFF_MS },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    this.logger.log(`Top-up ${order.id} queued for eSIM ${providerOrderId}`);
    return toOrderResponse(fulfilling);
  }
}
