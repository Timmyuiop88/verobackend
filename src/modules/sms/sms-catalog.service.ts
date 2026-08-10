import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductStatus,
  type SmsCountry,
  type SmsOneTimeOffer,
  type SmsRentalPlan,
  type SmsRentalSku,
  type SmsService,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type OfferWithRelations = SmsOneTimeOffer & {
  service: SmsService;
  country: SmsCountry;
};

export type PlanWithSku = SmsRentalPlan & {
  rentalSku: SmsRentalSku & { country: SmsCountry | null };
};

@Injectable()
export class SmsCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listCountries() {
    return this.prisma.smsCountry.findMany({
      orderBy: { name: 'asc' },
    });
  }

  listServices(query?: { q?: string }) {
    return this.prisma.smsService.findMany({
      where: query?.q
        ? { name: { contains: query.q, mode: 'insensitive' } }
        : undefined,
      orderBy: { name: 'asc' },
      take: 500,
    });
  }

  async listOneTimeOffers(params: {
    countryCode?: string;
    serviceId?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 24));
    const where: Prisma.SmsOneTimeOfferWhereInput = {
      status: ProductStatus.PUBLISHED,
      ...(params.serviceId ? { serviceId: params.serviceId } : {}),
      ...(params.countryCode
        ? { country: { code: params.countryCode.toUpperCase() } }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.smsOneTimeOffer.findMany({
        where,
        include: { service: true, country: true },
        orderBy: [{ retailPrice: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.smsOneTimeOffer.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async getPurchasableOffer(offerId: string): Promise<OfferWithRelations> {
    const offer = await this.prisma.smsOneTimeOffer.findUnique({
      where: { id: offerId },
      include: { service: true, country: true },
    });
    if (!offer || offer.status !== ProductStatus.PUBLISHED) {
      throw new NotFoundException('SMS offer not found or not published');
    }
    return offer;
  }

  async listRentalSkus(params: {
    countryCode?: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 24));
    const where: Prisma.SmsRentalSkuWhereInput = {
      status: ProductStatus.PUBLISHED,
      plans: { some: { status: ProductStatus.PUBLISHED } },
      ...(params.countryCode
        ? { countryCode: params.countryCode.toUpperCase() }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.smsRentalSku.findMany({
        where,
        include: {
          country: true,
          plans: {
            where: { status: ProductStatus.PUBLISHED },
            orderBy: { days: 'asc' },
          },
        },
        orderBy: [{ priority: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.smsRentalSku.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async getPurchasablePlan(planId: string): Promise<PlanWithSku> {
    const plan = await this.prisma.smsRentalPlan.findUnique({
      where: { id: planId },
      include: { rentalSku: { include: { country: true } } },
    });
    if (
      !plan ||
      plan.status !== ProductStatus.PUBLISHED ||
      plan.rentalSku.status !== ProductStatus.PUBLISHED
    ) {
      throw new NotFoundException('Rental plan not found or not published');
    }
    return plan;
  }

  async setOfferStatus(id: string, status: ProductStatus) {
    if (status === ProductStatus.DRAFT) {
      // ok
    } else if (
      status !== ProductStatus.PUBLISHED &&
      status !== ProductStatus.ARCHIVED
    ) {
      throw new BadRequestException('Invalid status');
    }
    return this.prisma.smsOneTimeOffer.update({
      where: { id },
      data: { status },
      include: { service: true, country: true },
    });
  }

  async setRentalSkuStatus(id: string, status: ProductStatus) {
    return this.prisma.smsRentalSku.update({
      where: { id },
      data: { status },
      include: {
        plans: true,
        country: true,
      },
    });
  }

  async setRentalPlanStatus(id: string, status: ProductStatus) {
    return this.prisma.smsRentalPlan.update({
      where: { id },
      data: { status },
      include: { rentalSku: true },
    });
  }

  async setOfferRetailPrice(id: string, retailPrice: string) {
    return this.prisma.smsOneTimeOffer.update({
      where: { id },
      data: {
        retailPrice: new Prisma.Decimal(retailPrice),
        manualOverride: true,
      },
    });
  }

  async setPlanRetailPrice(id: string, retailPrice: string) {
    return this.prisma.smsRentalPlan.update({
      where: { id },
      data: {
        retailPrice: new Prisma.Decimal(retailPrice),
        manualOverride: true,
      },
    });
  }
}
