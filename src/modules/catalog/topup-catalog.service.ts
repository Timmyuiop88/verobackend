import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PricingProfileName,
  Prisma,
  ProductStatus,
  type Product,
  type TopUpProduct,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import { PricingService } from './pricing.service';

/**
 * Admin-curated top-up catalog, synced per-product on demand (by packageCode
 * — no live eSIM/iccid needed) instead of live-queried per customer request.
 * Mirrors CatalogService's DRAFT -> review -> PUBLISHED flow for base
 * products so pricing/publishing feels identical for admins.
 */
@Injectable()
export class TopUpCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
    private readonly pricing: PricingService,
  ) {}

  private async getProductOrThrow(productId: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  private async getByIdOrThrow(id: string): Promise<TopUpProduct> {
    const topUpProduct = await this.prisma.topUpProduct.findUnique({
      where: { id },
    });
    if (!topUpProduct) {
      throw new NotFoundException('Top-up package not found');
    }
    return topUpProduct;
  }

  /**
   * The "check top-up prices" admin action: fetches this product's top-up
   * tiers from eSIM Access by packageCode and upserts them as DRAFT (or
   * refreshes cost/name on existing rows, preserving manual price overrides
   * — same convention as CatalogService.syncFromProvider).
   */
  async syncForProduct(
    productId: string,
  ): Promise<{ synced: number; created: number; updated: number }> {
    const product = await this.getProductOrThrow(productId);

    const packages = await this.esimAccess.listTopUpPackagesByCode(
      product.supplierSku,
    );

    await this.pricing.ensureDefaultProfiles();
    const standard = await this.pricing.getProfile(PricingProfileName.STANDARD);

    let created = 0;
    let updated = 0;

    for (const pkg of packages) {
      const costPrice = new Prisma.Decimal(
        EsimAccessService.apiPriceToUsd(pkg.price),
      ).toDecimalPlaces(2);

      const existing = await this.prisma.topUpProduct.findUnique({
        where: {
          productId_packageCode: { productId, packageCode: pkg.packageCode },
        },
      });

      if (!existing) {
        const rules = this.pricing.parseRules(standard.rules);
        const retailPrice = this.pricing.calculateRetailPrice(costPrice, rules);
        await this.prisma.topUpProduct.create({
          data: {
            productId,
            packageCode: pkg.packageCode,
            name: pkg.name,
            dataVolumeBytes: BigInt(pkg.volume ?? 0),
            durationDays: pkg.duration,
            costPrice,
            retailPrice,
            currency: pkg.currencyCode || 'USD',
            status: ProductStatus.DRAFT,
            pricingProfileId: standard.id,
            manualOverride: false,
            metadata: { slug: pkg.slug, speed: pkg.speed },
          },
        });
        created += 1;
      } else {
        const data: Prisma.TopUpProductUpdateInput = {
          name: pkg.name,
          dataVolumeBytes: BigInt(pkg.volume ?? 0),
          durationDays: pkg.duration,
          costPrice,
          currency: pkg.currencyCode || 'USD',
          metadata: { slug: pkg.slug, speed: pkg.speed },
        };

        if (!existing.manualOverride) {
          const profile = existing.pricingProfileId
            ? await this.prisma.pricingProfile.findUnique({
                where: { id: existing.pricingProfileId },
              })
            : standard;
          const profileRules = this.pricing.parseRules(
            profile?.rules ?? standard.rules,
          );
          data.retailPrice = this.pricing.calculateRetailPrice(
            costPrice,
            profileRules,
          );
        }

        await this.prisma.topUpProduct.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
      }
    }

    return { synced: packages.length, created, updated };
  }

  async listForProduct(productId: string): Promise<TopUpProduct[]> {
    await this.getProductOrThrow(productId);
    return this.prisma.topUpProduct.findMany({
      where: { productId },
      orderBy: { retailPrice: 'asc' },
    });
  }

  async setStatus(id: string, status: ProductStatus): Promise<TopUpProduct> {
    await this.getByIdOrThrow(id);
    return this.prisma.topUpProduct.update({ where: { id }, data: { status } });
  }

  async updatePricing(params: {
    id: string;
    pricingProfileName?: PricingProfileName;
    retailPrice?: number;
    manualOverride?: boolean;
  }): Promise<TopUpProduct> {
    const topUpProduct = await this.getByIdOrThrow(params.id);

    if (params.retailPrice !== undefined) {
      return this.prisma.topUpProduct.update({
        where: { id: topUpProduct.id },
        data: {
          retailPrice: new Prisma.Decimal(params.retailPrice).toDecimalPlaces(
            2,
          ),
          manualOverride: params.manualOverride ?? true,
        },
      });
    }

    if (params.pricingProfileName) {
      const profile = await this.pricing.getProfile(params.pricingProfileName);
      const rules = this.pricing.parseRules(profile.rules);
      const retailPrice = this.pricing.calculateRetailPrice(
        topUpProduct.costPrice,
        rules,
      );
      return this.prisma.topUpProduct.update({
        where: { id: topUpProduct.id },
        data: {
          pricingProfileId: profile.id,
          retailPrice,
          manualOverride: false,
        },
      });
    }

    return topUpProduct;
  }

  async setTopUpEnabled(productId: string, enabled: boolean): Promise<Product> {
    await this.getProductOrThrow(productId);
    return this.prisma.product.update({
      where: { id: productId },
      data: { topUpEnabled: enabled },
    });
  }

  /**
   * Customer-facing read for GET /esims/:id/topup-packages: published tiers
   * for the product an eSIM was originally sold under, gated on the parent
   * product's topUpEnabled kill switch. Purely a DB read — no live provider
   * call, unlike the final eligibility check done right before charging.
   */
  async listPublishedForProduct(
    productId: string | null,
  ): Promise<TopUpProduct[]> {
    if (!productId) {
      return [];
    }
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
    });
    if (!product?.topUpEnabled) {
      return [];
    }
    return this.prisma.topUpProduct.findMany({
      where: { productId, status: ProductStatus.PUBLISHED },
      orderBy: { retailPrice: 'asc' },
    });
  }
}
