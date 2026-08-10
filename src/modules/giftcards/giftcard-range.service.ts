import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  GiftCardDenominationType,
  Prisma,
  ProductStatus,
  type GiftCardDenomination,
  type GiftCardProduct,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReloadlyService } from '../integrations/reloadly/reloadly.service';
import { GiftCardPricingService } from './giftcard-pricing.service';

/**
 * RANGE products let the customer name their own amount, so there is no
 * fixed SKU to publish ahead of time.
 *
 * Rather than bolt a parallel purchase path onto orders, quoting
 * materializes a real `GiftCardDenomination` for the requested amount. The
 * existing purchase, fulfillment, refund and reveal flows then work
 * unchanged — a quoted RANGE amount is just a denomination that happened to
 * be created on demand.
 *
 * Amounts are restricted to whole units, which bounds how many rows a
 * product can accumulate to the width of its own range.
 */
@Injectable()
export class GiftCardRangeService {
  private readonly logger = new Logger(GiftCardRangeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reloadly: ReloadlyService,
    private readonly pricing: GiftCardPricingService,
  ) {}

  async quote(params: { idOrSlug: string; amount: number }): Promise<{
    product: GiftCardProduct;
    denomination: GiftCardDenomination;
  }> {
    const product = await this.prisma.giftCardProduct.findFirst({
      where: {
        status: ProductStatus.PUBLISHED,
        denominationType: GiftCardDenominationType.RANGE,
        OR: [{ slug: params.idOrSlug }, { id: params.idOrSlug }],
      },
    });
    if (!product) {
      throw new BadRequestException(
        'No published custom-amount gift card matches that id or slug',
      );
    }

    const faceValue = this.validateAmount(product, params.amount);
    const senderCost = await this.resolveSenderCost(product, faceValue);

    const rules = await this.pricing.loadRuleSet();
    const rule = this.pricing.resolveRule(rules, {
      pricingRuleId: product.pricingRuleId,
      productId: product.id,
      brandId: product.brandId,
      categoryId: product.categoryId,
      countryCode: product.countryCode,
    });

    const priced = this.pricing.price(
      {
        faceValue,
        senderCost,
        senderFeePercentage: product.senderFeePercentage,
        senderFeeFixed: product.senderFeeFixed,
        discountPercentage: product.discountPercentage,
        recipientCurrencyCode: product.recipientCurrencyCode,
        senderCurrencyCode: product.senderCurrencyCode,
        exchangeRate: product.exchangeRate,
      },
      rule,
    );

    if (!priced.viable) {
      throw new BadRequestException(
        `That amount cannot be sold profitably (${priced.viabilityNote ?? 'unknown reason'}) — try a different amount`,
      );
    }

    const shared = {
      senderCost,
      feeAmount: priced.feeAmount,
      discountAmount: priced.discountAmount,
      netCost: priced.netCost,
      retailPrice: priced.retailPrice,
      currency: product.senderCurrencyCode,
      viable: true,
      viabilityNote: null,
      // Priced live against the provider, so it goes straight on sale
      // instead of waiting for the DRAFT review the catalog sync requires.
      status: ProductStatus.PUBLISHED,
      lastSeenAt: new Date(),
    };

    const denomination = await this.prisma.giftCardDenomination.upsert({
      where: {
        productId_faceValue: { productId: product.id, faceValue },
      },
      create: { productId: product.id, faceValue, ...shared },
      // A previously quoted amount is repriced rather than reused: the
      // quote it was created from may be hours old.
      update: shared,
    });

    return { product, denomination };
  }

  private validateAmount(
    product: GiftCardProduct,
    amount: number,
  ): Prisma.Decimal {
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestException(
        'Amount must be a positive whole number of units',
      );
    }

    const value = new Prisma.Decimal(amount);
    const min = product.minRecipientDenomination;
    const max = product.maxRecipientDenomination;

    if (min && value.lt(min)) {
      throw new BadRequestException(
        `Minimum amount for ${product.name} is ${min.toFixed(2)} ${product.recipientCurrencyCode}`,
      );
    }
    if (max && value.gt(max)) {
      throw new BadRequestException(
        `Maximum amount for ${product.name} is ${max.toFixed(2)} ${product.recipientCurrencyCode}`,
      );
    }
    return value;
  }

  /**
   * A RANGE amount has no entry in the denomination map, so the cost has to
   * be asked for. Same-currency products skip the call — face value is the
   * cost by definition, and every avoided round trip is one less way for a
   * quote to fail.
   */
  private async resolveSenderCost(
    product: GiftCardProduct,
    faceValue: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    if (product.recipientCurrencyCode === product.senderCurrencyCode) {
      return faceValue;
    }

    try {
      const fx = await this.reloadly.getFxRate({
        currencyCode: product.recipientCurrencyCode,
        amount: Number(faceValue),
      });
      return new Prisma.Decimal(fx.senderAmount).toDecimalPlaces(4);
    } catch (error) {
      this.logger.warn(
        `FX lookup failed for ${product.name}: ${(error as Error).message}`,
      );
      throw new BadRequestException(
        'Could not price that amount right now — please try again shortly',
      );
    }
  }
}
