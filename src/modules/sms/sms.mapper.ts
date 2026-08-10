import type {
  NumberRental,
  NumberRentalMessage,
  Order,
  SmsCountry,
  SmsOneTimeOffer,
  SmsPricingRule,
  SmsRentalPlan,
  SmsRentalSku,
  SmsService,
  SmsSyncRun,
  SmsVerification,
} from '@prisma/client';

export function toSmsCountryDto(country: SmsCountry) {
  return {
    id: country.id,
    externalId: country.externalId,
    code: country.code,
    name: country.name,
    region: country.region,
  };
}

export function toSmsServiceDto(service: SmsService) {
  return {
    id: service.id,
    externalId: service.externalId,
    name: service.name,
    slug: service.slug,
  };
}

export function toSmsOfferDto(
  offer: SmsOneTimeOffer & { service: SmsService; country: SmsCountry },
) {
  return {
    id: offer.id,
    pool: offer.pool,
    providerCost: offer.providerCost.toString(),
    retailPrice: offer.retailPrice.toString(),
    currency: offer.currency,
    successRate: offer.successRate?.toString() ?? null,
    status: offer.status,
    service: toSmsServiceDto(offer.service),
    country: toSmsCountryDto(offer.country),
  };
}

export function toSmsRentalPlanDto(plan: SmsRentalPlan) {
  return {
    id: plan.id,
    days: plan.days,
    providerCost: plan.providerCost.toString(),
    retailPrice: plan.retailPrice.toString(),
    currency: plan.currency,
    stockCount: plan.stockCount,
    status: plan.status,
  };
}

export function toSmsRentalSkuDto(
  sku: SmsRentalSku & {
    country: SmsCountry | null;
    plans: SmsRentalPlan[];
  },
) {
  return {
    id: sku.id,
    externalId: sku.externalId,
    name: sku.name,
    slug: sku.slug,
    tag: sku.tag,
    region: sku.region,
    countryCode: sku.countryCode,
    extendable: sku.extendable,
    priority: sku.priority,
    status: sku.status,
    country: sku.country ? toSmsCountryDto(sku.country) : null,
    plans: sku.plans.map(toSmsRentalPlanDto),
  };
}

export function toVerificationOrderDto(
  order: Order & {
    smsVerification: SmsVerification | null;
    smsOneTimeOffer:
      | (SmsOneTimeOffer & { service: SmsService; country: SmsCountry })
      | null;
  },
) {
  return {
    id: order.id,
    status: order.status,
    amount: order.amount.toString(),
    currency: order.currency,
    failureReason: order.failureReason,
    createdAt: order.createdAt,
    offer: order.smsOneTimeOffer
      ? toSmsOfferDto(order.smsOneTimeOffer)
      : null,
    verification: order.smsVerification
      ? {
          id: order.smsVerification.id,
          status: order.smsVerification.status,
          phoneNumber: order.smsVerification.phoneNumber,
          countryCode: order.smsVerification.countryCode,
          smsCode: order.smsVerification.smsCode,
          fullSms: order.smsVerification.fullSms,
          expiresAt: order.smsVerification.expiresAt,
        }
      : null,
  };
}

export function toRentalDto(
  rental: NumberRental & {
    order: Order;
    plan: SmsRentalPlan & { rentalSku: SmsRentalSku };
    messages?: NumberRentalMessage[];
  },
) {
  return {
    id: rental.id,
    status: rental.status,
    phoneNumber: rental.phoneNumber,
    rentalCode: rental.rentalCode,
    days: rental.days,
    autoExtend: rental.autoExtend,
    expiresAt: rental.expiresAt,
    serviceExternalId: rental.serviceExternalId,
    serviceName: rental.serviceName,
    order: {
      id: rental.order.id,
      status: rental.order.status,
      amount: rental.order.amount.toString(),
      currency: rental.order.currency,
      failureReason: rental.order.failureReason,
      createdAt: rental.order.createdAt,
    },
    plan: toSmsRentalPlanDto(rental.plan),
    sku: {
      id: rental.plan.rentalSku.id,
      name: rental.plan.rentalSku.name,
      slug: rental.plan.rentalSku.slug,
      countryCode: rental.plan.rentalSku.countryCode,
      extendable: rental.plan.rentalSku.extendable,
    },
    messages: (rental.messages ?? []).map((m) => ({
      id: m.id,
      sender: m.sender,
      fullSms: m.fullSms,
      smsCode: m.smsCode,
      receivedAt: m.receivedAt,
    })),
  };
}

export function toSmsPricingRuleDto(rule: SmsPricingRule) {
  return {
    id: rule.id,
    scope: rule.scope,
    scopeRef: rule.scopeRef,
    name: rule.name,
    markupPercent: rule.markupPercent.toString(),
    floorAmount: rule.floorAmount?.toString() ?? null,
    active: rule.active,
  };
}

export function toSmsSyncRunDto(run: SmsSyncRun) {
  return {
    id: run.id,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    countriesSynced: run.countriesSynced,
    servicesSynced: run.servicesSynced,
    offersSynced: run.offersSynced,
    offersCreated: run.offersCreated,
    offersUpdated: run.offersUpdated,
    offersArchived: run.offersArchived,
    rentalSkusSynced: run.rentalSkusSynced,
    rentalPlansSynced: run.rentalPlansSynced,
    rentalPlansArchived: run.rentalPlansArchived,
    sweepSkippedReason: run.sweepSkippedReason,
    errors: run.errors,
  };
}
