import type {
  GiftCardBrand,
  GiftCardCategory,
  GiftCardCountry,
  GiftCardDenomination,
  GiftCardPricingRule,
  GiftCardSyncRun,
} from '@prisma/client';
import { formatUsd, toUsdAmount } from '../catalog/catalog.mapper';
import type { GiftCardProductWithRelations } from './giftcard-catalog.service';
import type { GiftCardOrderWithDetail } from './giftcard-orders.service';
import type { DecryptedCard } from './giftcard-fulfillment.service';
import type {
  GiftCardPricingRuleDto,
  GiftCardSyncRunDto,
} from './dto/giftcard-admin.dto';
import type {
  GiftCardOrderResponseDto,
  GiftCardRevealResponseDto,
} from './dto/giftcard-order-response.dto';
import type {
  AdminGiftCardDenominationDto,
  AdminGiftCardProductDto,
  GiftCardBrandDto,
  GiftCardCategoryDto,
  GiftCardCountryDto,
  GiftCardDenominationDto,
  GiftCardProductDto,
} from './dto/giftcard-response.dto';

function firstLogoUrl(logoUrls: unknown): string | null {
  return Array.isArray(logoUrls) && typeof logoUrls[0] === 'string'
    ? logoUrls[0]
    : null;
}

export function toGiftCardDenominationDto(
  denomination: GiftCardDenomination,
): GiftCardDenominationDto {
  const savings = denomination.faceValue.sub(denomination.retailPrice);
  return {
    id: denomination.id,
    faceValue: toUsdAmount(denomination.faceValue),
    faceValueDisplay: formatUsd(denomination.faceValue),
    price: toUsdAmount(denomination.retailPrice),
    priceDisplay: formatUsd(denomination.retailPrice),
    currency: denomination.currency,
    savings: savings.gt(0) ? toUsdAmount(savings) : null,
  };
}

export function toAdminGiftCardDenominationDto(
  denomination: GiftCardDenomination,
): AdminGiftCardDenominationDto {
  const margin = denomination.retailPrice.sub(denomination.netCost);
  return {
    ...toGiftCardDenominationDto(denomination),
    status: denomination.status,
    senderCost: toUsdAmount(denomination.senderCost),
    feeAmount: toUsdAmount(denomination.feeAmount),
    discountAmount: toUsdAmount(denomination.discountAmount),
    netCost: toUsdAmount(denomination.netCost),
    margin: toUsdAmount(margin),
    marginPercent: denomination.netCost.gt(0)
      ? margin.div(denomination.netCost).mul(100).toFixed(2)
      : '0.00',
    viable: denomination.viable,
    viabilityNote: denomination.viabilityNote,
    manualOverride: denomination.manualOverride,
  };
}

export function toGiftCardBrandDto(brand: GiftCardBrand): GiftCardBrandDto {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    logoUrl: brand.logoUrl,
  };
}

export function toGiftCardCategoryDto(
  category: GiftCardCategory,
): GiftCardCategoryDto {
  return {
    id: category.id,
    name: category.name,
    slug: category.slug,
    iconUrl: category.iconUrl,
    featured: category.featured,
  };
}

export function toGiftCardCountryDto(
  country: GiftCardCountry,
): GiftCardCountryDto {
  return {
    code: country.code,
    name: country.name,
    continent: country.continent,
    currencyCode: country.currencyCode,
    flagUrl: country.flagUrl,
  };
}

export function toGiftCardProductDto(
  product: GiftCardProductWithRelations,
): GiftCardProductDto {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    brand: product.brand ? toGiftCardBrandDto(product.brand) : null,
    category: product.category ? toGiftCardCategoryDto(product.category) : null,
    countryCode: product.countryCode,
    global: product.global,
    denominationType: product.denominationType,
    recipientCurrencyCode: product.recipientCurrencyCode,
    logoUrl: firstLogoUrl(product.logoUrls) ?? product.brand?.logoUrl ?? null,
    userIdRequired: product.userIdRequired,
    redeemInstructionConcise: product.redeemInstructionConcise,
    redeemInstructionVerbose: product.redeemInstructionVerbose,
    denominations: product.denominations.map(toGiftCardDenominationDto),
  };
}

export function toAdminGiftCardProductDto(
  product: GiftCardProductWithRelations,
): AdminGiftCardProductDto {
  return {
    ...toGiftCardProductDto(product),
    externalProductId: product.externalProductId,
    status: product.status,
    providerStatus: product.providerStatus,
    discountPercentage: product.discountPercentage.toString(),
    senderFeePercentage: product.senderFeePercentage.toString(),
    pricingRuleId: product.pricingRuleId,
    lastSeenAt: product.lastSeenAt,
    denominations: product.denominations.map(toAdminGiftCardDenominationDto),
  };
}

export function toGiftCardOrderResponse(
  order: GiftCardOrderWithDetail,
): GiftCardOrderResponseDto {
  const product = order.giftCardDenomination?.product ?? null;
  return {
    id: order.id,
    status: order.status,
    amount: toUsdAmount(order.amount),
    amountDisplay: formatUsd(order.amount),
    currency: order.currency,
    productName: product?.name ?? null,
    faceValue: order.giftCardDenomination
      ? toUsdAmount(order.giftCardDenomination.faceValue)
      : null,
    brandLogoUrl: firstLogoUrl(product?.logoUrls) ?? null,
    redeemInstructions:
      product?.redeemInstructionVerbose ??
      product?.redeemInstructionConcise ??
      null,
    providerStatus: order.giftCardIssuance?.providerStatus ?? null,
    // Presence only — the code itself never travels on a list response.
    codeAvailable: (order.giftCardIssuance?.cardCount ?? 0) > 0,
    revealedAt: order.giftCardIssuance?.revealedAt ?? null,
    failureReason: order.failureReason,
    createdAt: order.createdAt,
  };
}

export function toGiftCardRevealResponse(params: {
  order: GiftCardOrderWithDetail;
  cards: DecryptedCard[];
}): GiftCardRevealResponseDto {
  const product = params.order.giftCardDenomination?.product ?? null;
  return {
    orderId: params.order.id,
    productName: product?.name ?? 'Gift card',
    faceValue: params.order.giftCardDenomination
      ? toUsdAmount(params.order.giftCardDenomination.faceValue)
      : '0.00',
    redeemInstructions:
      product?.redeemInstructionVerbose ??
      product?.redeemInstructionConcise ??
      null,
    cards: params.cards.map((card) => ({
      cardNumber: card.cardNumber,
      pinCode: card.pinCode,
      redemptionUrl: card.redemptionUrl,
    })),
  };
}

export function toGiftCardPricingRuleDto(
  rule: GiftCardPricingRule,
): GiftCardPricingRuleDto {
  return {
    id: rule.id,
    scope: rule.scope,
    scopeRef: rule.scopeRef,
    name: rule.name,
    minMarginPercent: rule.minMarginPercent.toFixed(2),
    customerDiscountPercent: rule.customerDiscountPercent.toFixed(2),
    maxOverFacePercent: rule.maxOverFacePercent.toFixed(2),
    active: rule.active,
  };
}

export function toGiftCardSyncRunDto(run: GiftCardSyncRun): GiftCardSyncRunDto {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    countriesSynced: run.countriesSynced,
    categoriesSynced: run.categoriesSynced,
    brandsSynced: run.brandsSynced,
    pagesFetched: run.pagesFetched,
    productsSynced: run.productsSynced,
    productsCreated: run.productsCreated,
    productsUpdated: run.productsUpdated,
    productsArchived: run.productsArchived,
    denominationsSynced: run.denominationsSynced,
    denominationsHidden: run.denominationsHidden,
    sweepSkippedReason: run.sweepSkippedReason,
    errors: Array.isArray(run.errors) ? (run.errors as string[]) : null,
  };
}
