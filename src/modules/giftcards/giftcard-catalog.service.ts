import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  type GiftCardBrand,
  type GiftCardCategory,
  type GiftCardCountry,
  type GiftCardDenomination,
  type GiftCardProduct,
  type GiftCardSyncRun,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type GiftCardProductWithRelations = GiftCardProduct & {
  brand: GiftCardBrand | null;
  category: GiftCardCategory | null;
  denominations: GiftCardDenomination[];
};

const PUBLIC_DENOMINATION_FILTER = {
  status: ProductStatus.PUBLISHED,
  viable: true,
} as const;

@Injectable()
export class GiftCardCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------

  listCountries(q?: string): Promise<GiftCardCountry[]> {
    const search = q?.trim();
    return this.prisma.giftCardCountry.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      take: 300,
    });
  }

  listCategories(): Promise<GiftCardCategory[]> {
    return this.prisma.giftCardCategory.findMany({
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
  }

  listBrands(q?: string): Promise<GiftCardBrand[]> {
    const search = q?.trim();
    return this.prisma.giftCardBrand.findMany({
      where: search
        ? { name: { contains: search, mode: 'insensitive' } }
        : undefined,
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  // ---------------------------------------------------------------------
  // Public catalog
  // ---------------------------------------------------------------------

  private async buildPublicFilter(params: {
    q?: string;
    countryCode?: string;
    categorySlug?: string;
    brandSlug?: string;
    global?: boolean;
  }): Promise<Prisma.GiftCardProductWhereInput> {
    const where: Prisma.GiftCardProductWhereInput = {
      status: ProductStatus.PUBLISHED,
      // A product with nothing buyable under it is noise in the storefront.
      denominations: { some: PUBLIC_DENOMINATION_FILTER },
    };

    if (params.q?.trim()) {
      const q = params.q.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { brand: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }

    if (params.countryCode) {
      const code = params.countryCode.toUpperCase();
      // Global cards are redeemable anywhere, so they belong in every
      // country's results rather than only in their nominal country.
      where.AND = [{ OR: [{ countryCode: code }, { global: true }] }];
    }

    if (params.global !== undefined) {
      where.global = params.global;
    }

    if (params.categorySlug) {
      const category = await this.prisma.giftCardCategory.findUnique({
        where: { slug: params.categorySlug },
        select: { id: true },
      });
      where.categoryId = category?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    if (params.brandSlug) {
      const brand = await this.prisma.giftCardBrand.findUnique({
        where: { slug: params.brandSlug },
        select: { id: true },
      });
      where.brandId = brand?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    return where;
  }

  async listPublished(params: {
    q?: string;
    countryCode?: string;
    categorySlug?: string;
    brandSlug?: string;
    global?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    data: GiftCardProductWithRelations[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = await this.buildPublicFilter(params);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.giftCardProduct.findMany({
        where,
        include: {
          brand: true,
          category: true,
          denominations: {
            where: PUBLIC_DENOMINATION_FILTER,
            orderBy: { faceValue: 'asc' },
          },
        },
        orderBy: [{ name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.giftCardProduct.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getPublished(idOrSlug: string): Promise<GiftCardProductWithRelations> {
    const product = await this.prisma.giftCardProduct.findFirst({
      where: {
        status: ProductStatus.PUBLISHED,
        OR: [
          { slug: idOrSlug },
          ...(isUuid(idOrSlug) ? [{ id: idOrSlug }] : []),
        ],
      },
      include: {
        brand: true,
        category: true,
        denominations: {
          where: PUBLIC_DENOMINATION_FILTER,
          orderBy: { faceValue: 'asc' },
        },
      },
    });

    if (!product || product.denominations.length === 0) {
      throw new NotFoundException('Gift card not found');
    }
    return product;
  }

  /** Loads a denomination for purchase, rejecting anything not on sale. */
  async getPurchasableDenomination(
    denominationId: string,
  ): Promise<GiftCardDenomination & { product: GiftCardProduct }> {
    const denomination = await this.prisma.giftCardDenomination.findUnique({
      where: { id: denominationId },
      include: { product: true },
    });

    if (
      !denomination ||
      denomination.status !== ProductStatus.PUBLISHED ||
      !denomination.viable ||
      denomination.product.status !== ProductStatus.PUBLISHED
    ) {
      throw new NotFoundException('Gift card denomination is not available');
    }
    return denomination;
  }

  // ---------------------------------------------------------------------
  // Admin
  // ---------------------------------------------------------------------

  async listAll(params: {
    status?: ProductStatus;
    q?: string;
    countryCode?: string;
    categorySlug?: string;
    viableOnly?: boolean;
    page?: number;
    limit?: number;
  }): Promise<{
    data: GiftCardProductWithRelations[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;

    const where: Prisma.GiftCardProductWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...(params.countryCode
        ? { countryCode: params.countryCode.toUpperCase() }
        : {}),
      ...(params.q?.trim()
        ? {
            OR: [
              { name: { contains: params.q.trim(), mode: 'insensitive' } },
              {
                brand: {
                  name: { contains: params.q.trim(), mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
      ...(params.viableOnly
        ? { denominations: { some: { viable: true } } }
        : {}),
    };

    if (params.categorySlug) {
      const category = await this.prisma.giftCardCategory.findUnique({
        where: { slug: params.categorySlug },
        select: { id: true },
      });
      where.categoryId = category?.id ?? '00000000-0000-0000-0000-000000000000';
    }

    const [data, total] = await this.prisma.$transaction([
      this.prisma.giftCardProduct.findMany({
        where,
        include: {
          brand: true,
          category: true,
          denominations: { orderBy: { faceValue: 'asc' } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.giftCardProduct.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getForAdmin(id: string): Promise<GiftCardProductWithRelations> {
    const product = await this.prisma.giftCardProduct.findUnique({
      where: { id },
      include: {
        brand: true,
        category: true,
        denominations: { orderBy: { faceValue: 'asc' } },
      },
    });
    if (!product) {
      throw new NotFoundException('Gift card product not found');
    }
    return product;
  }

  /**
   * Publishing a product also publishes its viable denominations, since a
   * published product with no buyable tier is invisible anyway. Non-viable
   * tiers are deliberately left behind — they'd sell at a loss.
   */
  async setProductStatus(
    id: string,
    status: ProductStatus,
    cascade = true,
  ): Promise<GiftCardProductWithRelations> {
    await this.getForAdmin(id);

    await this.prisma.$transaction([
      this.prisma.giftCardProduct.update({ where: { id }, data: { status } }),
      ...(cascade
        ? [
            this.prisma.giftCardDenomination.updateMany({
              where: {
                productId: id,
                ...(status === ProductStatus.PUBLISHED ? { viable: true } : {}),
              },
              data: { status },
            }),
          ]
        : []),
    ]);

    return this.getForAdmin(id);
  }

  async setDenominationStatus(
    id: string,
    status: ProductStatus,
  ): Promise<GiftCardDenomination> {
    const denomination = await this.prisma.giftCardDenomination.findUnique({
      where: { id },
    });
    if (!denomination) {
      throw new NotFoundException('Denomination not found');
    }
    if (status === ProductStatus.PUBLISHED && !denomination.viable) {
      throw new BadRequestException(
        `Denomination is not viable (${denomination.viabilityNote ?? 'unknown reason'}) — set a manual retail price first`,
      );
    }
    return this.prisma.giftCardDenomination.update({
      where: { id },
      data: { status },
    });
  }

  /**
   * A manual retail price is honoured even when the automatic rules called
   * the denomination non-viable — an admin may accept a thin or negative
   * margin as a loss leader — but the row is only marked viable again when
   * the price genuinely clears cost.
   */
  async setDenominationPrice(params: {
    id: string;
    retailPrice: number;
    manualOverride?: boolean;
  }): Promise<GiftCardDenomination> {
    const denomination = await this.prisma.giftCardDenomination.findUnique({
      where: { id: params.id },
    });
    if (!denomination) {
      throw new NotFoundException('Denomination not found');
    }

    const retailPrice = new Prisma.Decimal(params.retailPrice).toDecimalPlaces(
      2,
    );
    const clearsCost = retailPrice.gt(denomination.netCost);

    return this.prisma.giftCardDenomination.update({
      where: { id: params.id },
      data: {
        retailPrice,
        manualOverride: params.manualOverride ?? true,
        viable: clearsCost,
        viabilityNote: clearsCost ? null : 'manual_price_below_net_cost',
      },
    });
  }

  async assignPricingRule(
    productId: string,
    pricingRuleId: string | null,
  ): Promise<GiftCardProductWithRelations> {
    await this.getForAdmin(productId);
    await this.prisma.giftCardProduct.update({
      where: { id: productId },
      data: { pricingRuleId },
    });
    return this.getForAdmin(productId);
  }

  listSyncRuns(limit = 20): Promise<GiftCardSyncRun[]> {
    return this.prisma.giftCardSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  async getSyncRun(id: string): Promise<GiftCardSyncRun> {
    const run = await this.prisma.giftCardSyncRun.findUnique({ where: { id } });
    if (!run) {
      throw new NotFoundException('Sync run not found');
    }
    return run;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
