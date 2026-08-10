import {
  GiftCardPricingScope,
  Prisma,
  type GiftCardPricingRule,
} from '@prisma/client';
import { GiftCardPricingService } from './giftcard-pricing.service';

function rule(
  overrides: Partial<GiftCardPricingRule> = {},
): GiftCardPricingRule {
  return {
    id: 'rule-1',
    scope: GiftCardPricingScope.GLOBAL,
    scopeRef: '*',
    name: 'Global default',
    minMarginPercent: new Prisma.Decimal(5),
    customerDiscountPercent: new Prisma.Decimal(1),
    maxOverFacePercent: new Prisma.Decimal(3),
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function inputs(
  overrides: Partial<Parameters<GiftCardPricingService['price']>[0]> = {},
) {
  return {
    faceValue: new Prisma.Decimal(50),
    senderCost: new Prisma.Decimal(50),
    senderFeePercentage: new Prisma.Decimal(0),
    senderFeeFixed: new Prisma.Decimal(0),
    discountPercentage: new Prisma.Decimal(0),
    recipientCurrencyCode: 'USD',
    senderCurrencyCode: 'USD',
    exchangeRate: new Prisma.Decimal(1),
    ...overrides,
  };
}

describe('GiftCardPricingService', () => {
  const service = new GiftCardPricingService({} as never);

  describe('price', () => {
    it('sells below face when the commission is generous enough', () => {
      const result = service.price(
        inputs({ discountPercentage: new Prisma.Decimal(8) }),
        rule(),
      );

      // netCost 46.00, floor 48.30, target 49.50 → target wins.
      expect(result.netCost.toFixed(2)).toBe('46.00');
      expect(result.retailPrice.toFixed(2)).toBe('49.50');
      expect(result.marginAmount.toFixed(2)).toBe('3.50');
      expect(result.viable).toBe(true);
    });

    it('holds the margin floor rather than matching face value', () => {
      // 2% commission can't fund a 5% margin at a 1% customer discount.
      const result = service.price(
        inputs({ discountPercentage: new Prisma.Decimal(2) }),
        rule(),
      );

      expect(result.netCost.toFixed(2)).toBe('49.00');
      expect(result.retailPrice.toFixed(2)).toBe('51.45');
      expect(result.marginAmount.toFixed(2)).toBe('2.45');
    });

    it('rejects a denomination whose floor breaches the over-face ceiling', () => {
      // Zero commission: the only viable price is above face + 3%.
      const result = service.price(inputs(), rule());

      expect(result.viable).toBe(false);
      expect(result.viabilityNote).toMatch(/price_exceeds_face_ceiling/);
    });

    it('accepts the same denomination under a rule that tolerates above-face pricing', () => {
      const result = service.price(
        inputs(),
        rule({ maxOverFacePercent: new Prisma.Decimal(15) }),
      );

      expect(result.viable).toBe(true);
      expect(result.retailPrice.toFixed(2)).toBe('52.50');
    });

    it('counts the provider fee against margin', () => {
      const result = service.price(
        inputs({
          discountPercentage: new Prisma.Decimal(8),
          senderFeePercentage: new Prisma.Decimal(1),
        }),
        rule(),
      );

      // 50 + 0.50 fee - 4.00 commission
      expect(result.netCost.toFixed(2)).toBe('46.50');
      expect(result.marginAmount.toFixed(2)).toBe('3.00');
    });

    it('falls back to cost as the face anchor when the exchange rate is implausible', () => {
      const result = service.price(
        inputs({
          recipientCurrencyCode: 'EUR',
          senderCurrencyCode: 'USD',
          // 50 x 570 = 28500, nowhere near the 55.00 actually charged.
          exchangeRate: new Prisma.Decimal(570),
          senderCost: new Prisma.Decimal(55),
          discountPercentage: new Prisma.Decimal(10),
        }),
        rule(),
      );

      expect(result.faceReference.toFixed(2)).toBe('55.00');
      expect(result.viabilityNote).toBe('face_value_estimated_from_cost');
      expect(result.viable).toBe(true);
    });

    it('converts face value when the exchange rate agrees with the quoted cost', () => {
      const result = service.price(
        inputs({
          faceValue: new Prisma.Decimal(50),
          recipientCurrencyCode: 'EUR',
          senderCurrencyCode: 'USD',
          exchangeRate: new Prisma.Decimal('1.1'),
          senderCost: new Prisma.Decimal(55),
          discountPercentage: new Prisma.Decimal(10),
        }),
        rule(),
      );

      expect(result.faceReference.toFixed(2)).toBe('55.00');
      expect(result.viabilityNote).toBeNull();
    });

    it('never rounds retail below the margin floor', () => {
      const result = service.price(
        inputs({
          faceValue: new Prisma.Decimal('9.99'),
          senderCost: new Prisma.Decimal('9.99'),
          discountPercentage: new Prisma.Decimal(7),
        }),
        rule({ maxOverFacePercent: new Prisma.Decimal(15) }),
      );

      const floor = result.netCost.mul(new Prisma.Decimal('1.05'));
      expect(result.retailPrice.gte(floor)).toBe(true);
    });
  });

  describe('resolveRule', () => {
    const globalRule = rule({ id: 'global' });
    const countryRule = rule({
      id: 'country',
      scope: GiftCardPricingScope.COUNTRY,
      scopeRef: 'US',
    });
    const brandRule = rule({
      id: 'brand',
      scope: GiftCardPricingScope.BRAND,
      scopeRef: 'brand-uuid',
    });
    const rules = [globalRule, countryRule, brandRule];

    it('prefers the most specific matching scope', () => {
      expect(
        service.resolveRule(rules, {
          brandId: 'brand-uuid',
          countryCode: 'US',
        }).id,
      ).toBe('brand');
    });

    it('skips scopes with no matching rule', () => {
      expect(
        service.resolveRule(rules, {
          brandId: 'other-brand',
          countryCode: 'US',
        }).id,
      ).toBe('country');
    });

    it('falls back to GLOBAL when nothing else matches', () => {
      expect(service.resolveRule(rules, { countryCode: 'JP' }).id).toBe(
        'global',
      );
    });

    it('honours an explicit pin over the scope chain', () => {
      expect(
        service.resolveRule(rules, {
          pricingRuleId: 'country',
          brandId: 'brand-uuid',
        }).id,
      ).toBe('country');
    });

    it('falls back to the scope chain when the pinned rule is gone', () => {
      expect(
        service.resolveRule(rules, {
          pricingRuleId: 'deleted-rule',
          brandId: 'brand-uuid',
        }).id,
      ).toBe('brand');
    });
  });
});
