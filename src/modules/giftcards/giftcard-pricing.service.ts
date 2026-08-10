import { Injectable, NotFoundException } from '@nestjs/common';
import {
  GiftCardPricingScope,
  Prisma,
  type GiftCardPricingRule,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

const ZERO = new Prisma.Decimal(0);
const HUNDRED = new Prisma.Decimal(100);

/** Most specific scope first — the first match wins. */
const SCOPE_PRIORITY: GiftCardPricingScope[] = [
  GiftCardPricingScope.PRODUCT,
  GiftCardPricingScope.BRAND,
  GiftCardPricingScope.CATEGORY,
  GiftCardPricingScope.COUNTRY,
  GiftCardPricingScope.GLOBAL,
];

export const GLOBAL_SCOPE_REF = '*';

export type PricingInputs = {
  /** Face value in the product's recipient currency. */
  faceValue: Prisma.Decimal;
  /** What Reloadly charges our balance, in sender currency, before fee/discount. */
  senderCost: Prisma.Decimal;
  senderFeePercentage: Prisma.Decimal;
  senderFeeFixed: Prisma.Decimal;
  discountPercentage: Prisma.Decimal;
  recipientCurrencyCode: string;
  senderCurrencyCode: string;
  /** recipientCurrencyToSenderCurrencyExchangeRate. */
  exchangeRate: Prisma.Decimal;
};

export type PricedDenomination = {
  feeAmount: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  netCost: Prisma.Decimal;
  retailPrice: Prisma.Decimal;
  /** Face value expressed in sender currency — the customer's mental anchor. */
  faceReference: Prisma.Decimal;
  marginAmount: Prisma.Decimal;
  marginPercent: Prisma.Decimal;
  viable: boolean;
  viabilityNote: string | null;
};

export type ScopeKeys = {
  /**
   * `GiftCardProduct.pricingRuleId` — an explicit pin to one rule, set via
   * the admin endpoint. Beats the scope chain entirely.
   */
  pricingRuleId?: string | null;
  productId?: string | null;
  brandId?: string | null;
  categoryId?: string | null;
  countryCode?: string | null;
};

/**
 * Gift card pricing.
 *
 * eSIM products can carry a flat cost markup because customers can't price
 * a data package independently. Gift cards are the opposite: face value is
 * public, so retail has to sit at or near it and the margin comes from
 * Reloadly's `discountPercentage` commission.
 *
 *   netCost = senderCost + fee - discount
 *   floor   = netCost x (1 + minMarginPercent)
 *   target  = faceReference x (1 - customerDiscountPercent)
 *   retail  = max(floor, target)
 *
 * `target` keeps well-discounted products competitive; `floor` stops the
 * thousands of low- and zero-discount products in the catalog from being
 * sold at or below cost. Anything whose floor overshoots
 * `faceReference x (1 + maxOverFacePercent)` is marked non-viable and is
 * never auto-published — that ceiling is what distinguishes gaming top-ups
 * (no face-value anchor, tolerate 15% over) from retail brand cards
 * (nobody pays above face).
 */
@Injectable()
export class GiftCardPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultRule(): Promise<GiftCardPricingRule> {
    return this.prisma.giftCardPricingRule.upsert({
      where: {
        scope_scopeRef: {
          scope: GiftCardPricingScope.GLOBAL,
          scopeRef: GLOBAL_SCOPE_REF,
        },
      },
      create: {
        scope: GiftCardPricingScope.GLOBAL,
        scopeRef: GLOBAL_SCOPE_REF,
        name: 'Global default',
        minMarginPercent: new Prisma.Decimal(5),
        customerDiscountPercent: new Prisma.Decimal(1),
        maxOverFacePercent: new Prisma.Decimal(3),
      },
      update: {},
    });
  }

  /**
   * Loads every active rule once so a sync run over thousands of products
   * resolves scopes in memory instead of querying per product.
   */
  async loadRuleSet(): Promise<GiftCardPricingRule[]> {
    await this.ensureDefaultRule();
    return this.prisma.giftCardPricingRule.findMany({
      where: { active: true },
    });
  }

  resolveRule(
    rules: GiftCardPricingRule[],
    keys: ScopeKeys,
  ): GiftCardPricingRule {
    if (keys.pricingRuleId) {
      const pinned = rules.find((rule) => rule.id === keys.pricingRuleId);
      if (pinned) {
        return pinned;
      }
      // Pinned to a rule that has since been deleted or deactivated — fall
      // through to the scope chain rather than failing the whole sync.
    }

    const refFor = (scope: GiftCardPricingScope): string | null => {
      switch (scope) {
        case GiftCardPricingScope.PRODUCT:
          return keys.productId ?? null;
        case GiftCardPricingScope.BRAND:
          return keys.brandId ?? null;
        case GiftCardPricingScope.CATEGORY:
          return keys.categoryId ?? null;
        case GiftCardPricingScope.COUNTRY:
          return keys.countryCode ?? null;
        case GiftCardPricingScope.GLOBAL:
          return GLOBAL_SCOPE_REF;
      }
    };

    for (const scope of SCOPE_PRIORITY) {
      const ref = refFor(scope);
      if (!ref) {
        continue;
      }
      const match = rules.find(
        (rule) => rule.scope === scope && rule.scopeRef === ref,
      );
      if (match) {
        return match;
      }
    }

    throw new NotFoundException(
      'No gift card pricing rule matched and no GLOBAL fallback exists',
    );
  }

  /**
   * Face value converted into the currency we actually charge in.
   *
   * The exchange rate Reloadly reports is occasionally inconsistent with the
   * denomination map (their own docs' sample data disagrees), so a converted
   * value that lands wildly away from the real cost is discarded in favour of
   * the cost itself. That degrades pricing for those products to a plain
   * cost-plus-margin, which is safe, rather than trusting a bad rate and
   * pricing at a loss.
   */
  private faceValueInSenderCurrency(inputs: PricingInputs): {
    value: Prisma.Decimal;
    trusted: boolean;
  } {
    if (inputs.recipientCurrencyCode === inputs.senderCurrencyCode) {
      return { value: inputs.faceValue, trusted: true };
    }

    const rate = inputs.exchangeRate;
    if (rate.lte(ZERO)) {
      return { value: inputs.senderCost, trusted: false };
    }

    const converted = inputs.faceValue.mul(rate);
    const withinSaneBand =
      inputs.senderCost.gt(ZERO) &&
      converted.gte(inputs.senderCost.mul(new Prisma.Decimal('0.5'))) &&
      converted.lte(inputs.senderCost.mul(2));

    return withinSaneBand
      ? { value: converted, trusted: true }
      : { value: inputs.senderCost, trusted: false };
  }

  price(inputs: PricingInputs, rule: GiftCardPricingRule): PricedDenomination {
    const feeAmount = inputs.senderCost
      .mul(inputs.senderFeePercentage)
      .div(HUNDRED)
      .add(inputs.senderFeeFixed)
      .toDecimalPlaces(4);

    // Reloadly's commission is a rebate on what we spend, so it is taken
    // against the sender amount rather than the face value.
    const discountAmount = inputs.senderCost
      .mul(inputs.discountPercentage)
      .div(HUNDRED)
      .toDecimalPlaces(4);

    const netCost = inputs.senderCost
      .add(feeAmount)
      .sub(discountAmount)
      .toDecimalPlaces(4);

    const { value: faceReference, trusted } =
      this.faceValueInSenderCurrency(inputs);

    const floor = netCost.mul(
      new Prisma.Decimal(1).add(rule.minMarginPercent.div(HUNDRED)),
    );
    const target = faceReference.mul(
      new Prisma.Decimal(1).sub(rule.customerDiscountPercent.div(HUNDRED)),
    );

    // Round up: a half-cent rounded down could drop retail back under the
    // margin floor the rule just guaranteed.
    const retailPrice = (floor.gt(target) ? floor : target).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_UP,
    );

    const ceiling = faceReference.mul(
      new Prisma.Decimal(1).add(rule.maxOverFacePercent.div(HUNDRED)),
    );

    const marginAmount = retailPrice.sub(netCost).toDecimalPlaces(4);
    const marginPercent = netCost.gt(ZERO)
      ? marginAmount.div(netCost).mul(HUNDRED).toDecimalPlaces(2)
      : ZERO;

    let viable = true;
    let viabilityNote: string | null = null;

    if (netCost.lte(ZERO)) {
      viable = false;
      viabilityNote = 'net_cost_not_positive';
    } else if (marginAmount.lte(ZERO)) {
      viable = false;
      viabilityNote = 'no_margin_at_computed_price';
    } else if (retailPrice.gt(ceiling)) {
      viable = false;
      viabilityNote = `price_exceeds_face_ceiling:retail=${retailPrice.toFixed(2)},ceiling=${ceiling.toFixed(2)}`;
    } else if (!trusted) {
      // Sellable, but the face-value anchor came from cost rather than a
      // trusted FX rate — worth surfacing to an admin before publishing.
      viabilityNote = 'face_value_estimated_from_cost';
    }

    return {
      feeAmount,
      discountAmount,
      netCost,
      retailPrice,
      faceReference: faceReference.toDecimalPlaces(4),
      marginAmount,
      marginPercent,
      viable,
      viabilityNote,
    };
  }

  // ---------------------------------------------------------------------
  // Admin rule management
  // ---------------------------------------------------------------------

  async listRules(): Promise<GiftCardPricingRule[]> {
    await this.ensureDefaultRule();
    return this.prisma.giftCardPricingRule.findMany({
      orderBy: [{ scope: 'asc' }, { name: 'asc' }],
    });
  }

  async upsertRule(params: {
    scope: GiftCardPricingScope;
    scopeRef?: string;
    name: string;
    minMarginPercent?: number;
    customerDiscountPercent?: number;
    maxOverFacePercent?: number;
    active?: boolean;
  }): Promise<GiftCardPricingRule> {
    const scopeRef =
      params.scope === GiftCardPricingScope.GLOBAL
        ? GLOBAL_SCOPE_REF
        : (params.scopeRef ?? GLOBAL_SCOPE_REF);

    const values = {
      name: params.name,
      ...(params.minMarginPercent !== undefined
        ? { minMarginPercent: new Prisma.Decimal(params.minMarginPercent) }
        : {}),
      ...(params.customerDiscountPercent !== undefined
        ? {
            customerDiscountPercent: new Prisma.Decimal(
              params.customerDiscountPercent,
            ),
          }
        : {}),
      ...(params.maxOverFacePercent !== undefined
        ? { maxOverFacePercent: new Prisma.Decimal(params.maxOverFacePercent) }
        : {}),
      ...(params.active !== undefined ? { active: params.active } : {}),
    };

    return this.prisma.giftCardPricingRule.upsert({
      where: { scope_scopeRef: { scope: params.scope, scopeRef } },
      create: { scope: params.scope, scopeRef, ...values },
      update: values,
    });
  }

  async deleteRule(id: string): Promise<void> {
    const rule = await this.prisma.giftCardPricingRule.findUnique({
      where: { id },
    });
    if (!rule) {
      throw new NotFoundException('Pricing rule not found');
    }
    if (rule.scope === GiftCardPricingScope.GLOBAL) {
      throw new NotFoundException(
        'The GLOBAL fallback rule cannot be deleted — edit it instead',
      );
    }
    await this.prisma.giftCardPricingRule.delete({ where: { id } });
  }
}
