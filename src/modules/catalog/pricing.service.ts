import { Injectable } from '@nestjs/common';
import {
  PricingProfileName,
  Prisma,
  type PricingProfile,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type MarkupRule = {
  type: 'percent' | 'fixed';
  value: number;
};

const DEFAULT_RULES: Record<PricingProfileName, MarkupRule> = {
  [PricingProfileName.STANDARD]: { type: 'percent', value: 30 },
  [PricingProfileName.COMPETITIVE]: { type: 'percent', value: 15 },
  [PricingProfileName.PREMIUM]: { type: 'percent', value: 50 },
};

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultProfiles(): Promise<void> {
    for (const name of Object.values(PricingProfileName)) {
      await this.prisma.pricingProfile.upsert({
        where: { name },
        create: {
          name,
          rules: DEFAULT_RULES[name],
        },
        update: {},
      });
    }
  }

  async getProfile(
    name: PricingProfileName = PricingProfileName.STANDARD,
  ): Promise<PricingProfile> {
    await this.ensureDefaultProfiles();
    return this.prisma.pricingProfile.findUniqueOrThrow({ where: { name } });
  }

  calculateRetailPrice(
    costPrice: Prisma.Decimal | number | string,
    rules: MarkupRule,
  ): Prisma.Decimal {
    const cost = new Prisma.Decimal(costPrice);
    const raw =
      rules.type === 'fixed'
        ? cost.add(rules.value)
        : cost.mul(
            new Prisma.Decimal(1).add(new Prisma.Decimal(rules.value).div(100)),
          );
    // Store/display as USD with 2 decimal places
    return raw.toDecimalPlaces(2);
  }

  parseRules(rules: Prisma.JsonValue): MarkupRule {
    const obj = rules as MarkupRule;
    if (
      !obj ||
      (obj.type !== 'percent' && obj.type !== 'fixed') ||
      typeof obj.value !== 'number'
    ) {
      return DEFAULT_RULES.STANDARD;
    }
    return obj;
  }
}
