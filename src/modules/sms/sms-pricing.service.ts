import { Injectable } from '@nestjs/common';
import {
  Prisma,
  SmsPricingScope,
  type SmsPricingRule,
} from '@prisma/client';

export type PricedOffer = {
  retailPrice: Prisma.Decimal;
  rule: SmsPricingRule | null;
};

/**
 * retail = max(cost × (1 + markup%), floorAmount?).
 * Most specific active rule wins: RENTAL_SKU/SERVICE > COUNTRY > GLOBAL.
 */
@Injectable()
export class SmsPricingService {
  resolveRule(
    rules: SmsPricingRule[],
    context: {
      pricingRuleId?: string | null;
      countryCode?: string | null;
      serviceId?: string | null;
      rentalSkuId?: string | null;
    },
  ): SmsPricingRule | null {
    if (context.pricingRuleId) {
      const pinned = rules.find(
        (rule) => rule.id === context.pricingRuleId && rule.active,
      );
      if (pinned) return pinned;
    }

    const active = rules.filter((rule) => rule.active);
    const byScope = (scope: SmsPricingScope, ref: string) =>
      active.find((rule) => rule.scope === scope && rule.scopeRef === ref);

    if (context.rentalSkuId) {
      const hit = byScope(SmsPricingScope.RENTAL_SKU, context.rentalSkuId);
      if (hit) return hit;
    }
    if (context.serviceId) {
      const hit = byScope(SmsPricingScope.SERVICE, context.serviceId);
      if (hit) return hit;
    }
    if (context.countryCode) {
      const hit = byScope(SmsPricingScope.COUNTRY, context.countryCode);
      if (hit) return hit;
    }
    return byScope(SmsPricingScope.GLOBAL, '*') ?? null;
  }

  price(
    providerCost: Prisma.Decimal | number | string,
    rule: SmsPricingRule | null,
  ): PricedOffer {
    const cost = new Prisma.Decimal(providerCost);
    const markup = rule
      ? new Prisma.Decimal(rule.markupPercent)
      : new Prisma.Decimal(20);
    let retail = cost.mul(markup.div(100).add(1)).toDecimalPlaces(4);

    if (rule?.floorAmount && retail.lt(rule.floorAmount)) {
      retail = new Prisma.Decimal(rule.floorAmount).toDecimalPlaces(4);
    }
    if (retail.lte(0)) {
      retail = cost.toDecimalPlaces(4);
    }

    return { retailPrice: retail, rule };
  }
}
