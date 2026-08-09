import { Injectable, NotFoundException } from '@nestjs/common';
import {
  PricingProfileName,
  ProductStatus,
  Prisma,
  type Product,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import { PricingService } from './pricing.service';
import { RegionsService } from './regions.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
    private readonly pricing: PricingService,
    private readonly regionsService: RegionsService,
  ) {}

  async syncFromProvider(): Promise<{
    synced: number;
    created: number;
    updated: number;
    regionsSynced: number;
    regionsCreated: number;
    regionsUpdated: number;
  }> {
    const regions = await this.regionsService.syncFromProvider();

    await this.pricing.ensureDefaultProfiles();
    const standard = await this.pricing.getProfile(PricingProfileName.STANDARD);
    const packages = await this.esimAccess.listPackages();

    let created = 0;
    let updated = 0;

    for (const pkg of packages) {
      const costPrice = new Prisma.Decimal(
        EsimAccessService.apiPriceToUsd(pkg.price),
      ).toDecimalPlaces(2);
      const rules = this.pricing.parseRules(standard.rules);
      const retailPrice = this.pricing.calculateRetailPrice(costPrice, rules);

      const existing = await this.prisma.product.findUnique({
        where: { supplierSku: pkg.packageCode },
      });

      const durationDays =
        pkg.durationUnit?.toUpperCase() === 'DAY' ? pkg.duration : pkg.duration;

      if (!existing) {
        await this.prisma.product.create({
          data: {
            supplierSku: pkg.packageCode,
            name: pkg.name,
            locationCode: pkg.location,
            dataVolumeBytes: BigInt(pkg.volume ?? 0),
            durationDays,
            costPrice,
            retailPrice,
            currency: pkg.currencyCode || 'USD',
            status: ProductStatus.DRAFT,
            pricingProfileId: standard.id,
            manualOverride: false,
            metadata: {
              slug: pkg.slug,
              speed: pkg.speed,
              supportTopUpType: pkg.supportTopUpType,
            },
          },
        });
        created += 1;
      } else {
        const data: Prisma.ProductUpdateInput = {
          name: pkg.name,
          locationCode: pkg.location,
          dataVolumeBytes: BigInt(pkg.volume ?? 0),
          durationDays,
          costPrice,
          metadata: {
            slug: pkg.slug,
            speed: pkg.speed,
            supportTopUpType: pkg.supportTopUpType,
          },
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

        await this.prisma.product.update({
          where: { id: existing.id },
          data,
        });
        updated += 1;
      }
    }

    return {
      synced: packages.length,
      created,
      updated,
      regionsSynced: regions.synced,
      regionsCreated: regions.created,
      regionsUpdated: regions.updated,
    };
  }

  private async buildLocationFilter(params: {
    locationCode?: string;
    country?: string;
  }): Promise<Prisma.ProductWhereInput> {
    if (params.locationCode) {
      return { locationCode: params.locationCode };
    }
    if (params.country) {
      const codes = await this.regionsService.resolveLocationCodes(
        params.country,
      );
      if (codes.length === 0) {
        return { locationCode: '__none__' };
      }
      return { locationCode: { in: codes } };
    }
    return {};
  }

  async listPublished(params: {
    locationCode?: string;
    country?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Product[]; total: number; page: number; limit: number }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const locationFilter = await this.buildLocationFilter(params);
    const where: Prisma.ProductWhereInput = {
      status: ProductStatus.PUBLISHED,
      ...locationFilter,
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ locationCode: 'asc' }, { retailPrice: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  async getPublishedById(id: string): Promise<Product> {
    const product = await this.prisma.product.findFirst({
      where: { id, status: ProductStatus.PUBLISHED },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async getById(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async setStatus(id: string, status: ProductStatus): Promise<Product> {
    await this.getById(id);
    return this.prisma.product.update({
      where: { id },
      data: { status },
    });
  }

  async updatePricing(params: {
    id: string;
    pricingProfileName?: PricingProfileName;
    retailPrice?: number;
    manualOverride?: boolean;
  }): Promise<Product> {
    const product = await this.getById(params.id);

    if (params.retailPrice !== undefined) {
      return this.prisma.product.update({
        where: { id: product.id },
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
        product.costPrice,
        rules,
      );
      return this.prisma.product.update({
        where: { id: product.id },
        data: {
          pricingProfileId: profile.id,
          retailPrice,
          manualOverride: false,
        },
      });
    }

    return product;
  }

  async listAll(params: {
    status?: ProductStatus;
    locationCode?: string;
    country?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: Product[]; total: number; page: number; limit: number }> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const locationFilter = await this.buildLocationFilter(params);
    const where: Prisma.ProductWhereInput = {
      ...(params.status ? { status: params.status } : {}),
      ...locationFilter,
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.product.count({ where }),
    ]);

    return { data, total, page, limit };
  }
}
