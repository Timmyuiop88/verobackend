import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  ProductStatus,
  SmsSyncStatus,
  type SmsPricingRule,
  type SmsSyncRun,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { opsAlert } from '../../common/observability/ops-alert';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env.schema';
import { SmsPoolService } from '../integrations/smspool/smspool.service';
import type {
  SmsPoolPriceRow,
  SmsPoolRentalSku,
} from '../integrations/smspool/smspool.types';
import { SMS_SYNC_WRITE_BATCH_SIZE } from './sms.constants';
import { SmsPricingService } from './sms-pricing.service';
import { chunk, externalSlug, mapInChunks, slugify } from './sms.util';

type SyncTally = {
  countriesSynced: number;
  servicesSynced: number;
  offersSynced: number;
  offersCreated: number;
  offersUpdated: number;
  offersArchived: number;
  rentalSkusSynced: number;
  rentalPlansSynced: number;
  rentalPlansArchived: number;
  errors: string[];
  sweepSkippedReason: string | null;
};

@Injectable()
export class SmsSyncService {
  private readonly logger = new Logger(SmsSyncService.name);
  private readonly archiveMaxPercent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly smspool: SmsPoolService,
    private readonly pricing: SmsPricingService,
    config: ConfigService<Env, true>,
  ) {
    this.archiveMaxPercent = config.get('SMSPOOL_ARCHIVE_SWEEP_MAX_PERCENT', {
      infer: true,
    });
  }

  async run(trigger: 'cron' | 'admin'): Promise<SmsSyncRun> {
    const run = await this.prisma.smsSyncRun.create({
      data: { id: randomUUID(), trigger, status: SmsSyncStatus.RUNNING },
    });
    const runStartedAt = run.startedAt;
    const tally: SyncTally = {
      countriesSynced: 0,
      servicesSynced: 0,
      offersSynced: 0,
      offersCreated: 0,
      offersUpdated: 0,
      offersArchived: 0,
      rentalSkusSynced: 0,
      rentalPlansSynced: 0,
      rentalPlansArchived: 0,
      errors: [],
      sweepSkippedReason: null,
    };

    try {
      await this.ensureGlobalPricingRule();
      const rules = await this.prisma.smsPricingRule.findMany({
        where: { active: true },
      });

      tally.countriesSynced = await this.syncCountries();
      tally.servicesSynced = await this.syncServices();
      await this.syncOneTimeOffers(runStartedAt, rules, tally);
      await this.syncRentals(runStartedAt, rules, tally);
      await this.archiveStale(runStartedAt, tally);

      const finished = await this.prisma.smsSyncRun.update({
        where: { id: run.id },
        data: {
          status:
            tally.errors.length > 0
              ? SmsSyncStatus.COMPLETED
              : SmsSyncStatus.COMPLETED,
          finishedAt: new Date(),
          countriesSynced: tally.countriesSynced,
          servicesSynced: tally.servicesSynced,
          offersSynced: tally.offersSynced,
          offersCreated: tally.offersCreated,
          offersUpdated: tally.offersUpdated,
          offersArchived: tally.offersArchived,
          rentalSkusSynced: tally.rentalSkusSynced,
          rentalPlansSynced: tally.rentalPlansSynced,
          rentalPlansArchived: tally.rentalPlansArchived,
          sweepSkippedReason: tally.sweepSkippedReason,
          errors: tally.errors.length ? tally.errors : Prisma.JsonNull,
        },
      });

      if (tally.errors.length) {
        opsAlert('smspool_sync_completed_with_errors', {
          runId: run.id,
          errorCount: tally.errors.length,
          firstError: tally.errors[0],
        });
      }

      try {
        const balance = await this.smspool.getBalance();
        const value = Number(balance.balance);
        if (
          !Number.isNaN(value) &&
          value < this.smspool.minimumBalanceAlertThreshold
        ) {
          opsAlert('smspool_low_balance', { balance: value });
        }
      } catch (error) {
        this.logger.warn(`SMSPool balance check failed: ${(error as Error).message}`);
      }

      return finished;
    } catch (error) {
      const message = (error as Error).message;
      tally.errors.push(`fatal:\n${message}`);
      opsAlert('smspool_sync_failed', { runId: run.id, message });
      return this.prisma.smsSyncRun.update({
        where: { id: run.id },
        data: {
          status: SmsSyncStatus.FAILED,
          finishedAt: new Date(),
          errors: tally.errors,
          countriesSynced: tally.countriesSynced,
          servicesSynced: tally.servicesSynced,
          offersSynced: tally.offersSynced,
          offersCreated: tally.offersCreated,
          offersUpdated: tally.offersUpdated,
          offersArchived: tally.offersArchived,
          rentalSkusSynced: tally.rentalSkusSynced,
          rentalPlansSynced: tally.rentalPlansSynced,
          rentalPlansArchived: tally.rentalPlansArchived,
          sweepSkippedReason: tally.sweepSkippedReason,
        },
      });
    }
  }

  private async ensureGlobalPricingRule(): Promise<void> {
    await this.prisma.smsPricingRule.upsert({
      where: { scope_scopeRef: { scope: 'GLOBAL', scopeRef: '*' } },
      create: {
        scope: 'GLOBAL',
        scopeRef: '*',
        name: 'Default SMS markup',
        markupPercent: new Prisma.Decimal(20),
      },
      update: {},
    });
  }

  private async syncCountries(): Promise<number> {
    const countries = await this.smspool.listCountries();
    await mapInChunks(countries, SMS_SYNC_WRITE_BATCH_SIZE, (country) =>
      this.prisma.smsCountry.upsert({
        where: { externalId: country.ID },
        create: {
          externalId: country.ID,
          code: country.short_name,
          name: country.name,
          region: country.region ?? null,
        },
        update: {
          code: country.short_name,
          name: country.name,
          region: country.region ?? null,
        },
      }),
    );
    return countries.length;
  }

  private async syncServices(): Promise<number> {
    const services = await this.smspool.listServices();
    await mapInChunks(services, SMS_SYNC_WRITE_BATCH_SIZE, (service) =>
      this.prisma.smsService.upsert({
        where: { externalId: service.ID },
        create: {
          externalId: service.ID,
          name: service.name,
          slug: externalSlug(service.name, service.ID),
        },
        update: { name: service.name },
      }),
    );
    return services.length;
  }

  private async syncOneTimeOffers(
    runStartedAt: Date,
    rules: SmsPricingRule[],
    tally: SyncTally,
  ): Promise<void> {
    let rows: SmsPoolPriceRow[] = [];
    try {
      rows = await this.smspool.listPricing();
    } catch (error) {
      tally.errors.push(`pricing:\n${(error as Error).message}`);
      return;
    }

    const countries = await this.prisma.smsCountry.findMany({
      select: { id: true, externalId: true, code: true },
    });
    const services = await this.prisma.smsService.findMany({
      select: { id: true, externalId: true },
    });
    const countryByExternal = new Map(
      countries.map((c) => [c.externalId, c]),
    );
    const serviceByExternal = new Map(
      services.map((s) => [s.externalId, s]),
    );

    const existing = await this.prisma.smsOneTimeOffer.findMany({
      select: {
        id: true,
        serviceId: true,
        countryId: true,
        pool: true,
        manualOverride: true,
        pricingRuleId: true,
        status: true,
      },
    });
    const existingKey = new Map(
      existing.map((o) => [`${o.serviceId}:${o.countryId}:${o.pool}`, o]),
    );

    type Draft = {
      serviceId: string;
      countryId: string;
      countryCode: string;
      pool: number;
      cost: Prisma.Decimal;
    };
    // Pricing API can return the same service×country×pool more than once.
    // Deduplicate before write — parallel creates race on the unique key.
    const draftsByKey = new Map<string, Draft>();
    for (const row of rows) {
      const service = serviceByExternal.get(Number(row.service));
      const country = countryByExternal.get(Number(row.country));
      if (!service || !country) continue;
      const cost = new Prisma.Decimal(row.price);
      if (cost.lte(0)) continue;
      const pool = Number(row.pool ?? 0);
      const key = `${service.id}:${country.id}:${pool}`;
      draftsByKey.set(key, {
        serviceId: service.id,
        countryId: country.id,
        countryCode: country.code,
        pool,
        cost,
      });
    }
    const drafts = [...draftsByKey.values()];

    await mapInChunks(drafts, SMS_SYNC_WRITE_BATCH_SIZE, async (draft) => {
      const key = `${draft.serviceId}:${draft.countryId}:${draft.pool}`;
      const prior = existingKey.get(key);
      const rule = this.pricing.resolveRule(rules, {
        pricingRuleId: prior?.pricingRuleId,
        countryCode: draft.countryCode,
        serviceId: draft.serviceId,
      });
      const priced = this.pricing.price(draft.cost, rule);

      const saved = await this.prisma.smsOneTimeOffer.upsert({
        where: {
          serviceId_countryId_pool: {
            serviceId: draft.serviceId,
            countryId: draft.countryId,
            pool: draft.pool,
          },
        },
        create: {
          serviceId: draft.serviceId,
          countryId: draft.countryId,
          pool: draft.pool,
          providerCost: draft.cost,
          retailPrice: priced.retailPrice,
          status: ProductStatus.DRAFT,
          lastSeenAt: runStartedAt,
        },
        update: {
          providerCost: draft.cost,
          lastSeenAt: runStartedAt,
          ...(prior?.manualOverride ? {} : { retailPrice: priced.retailPrice }),
        },
      });

      if (prior) {
        tally.offersUpdated += 1;
      } else {
        tally.offersCreated += 1;
        existingKey.set(key, {
          id: saved.id,
          serviceId: saved.serviceId,
          countryId: saved.countryId,
          pool: saved.pool,
          manualOverride: saved.manualOverride,
          pricingRuleId: saved.pricingRuleId,
          status: saved.status,
        });
      }
      tally.offersSynced += 1;
    });
  }

  private async syncRentals(
    runStartedAt: Date,
    rules: SmsPricingRule[],
    tally: SyncTally,
  ): Promise<void> {
    const countries = await this.prisma.smsCountry.findMany({
      select: { id: true, code: true, name: true },
    });
    const countryByCode = new Map(
      countries.map((c) => [c.code.toUpperCase(), c]),
    );
    const countryByName = new Map(
      countries.map((c) => [c.name.toLowerCase(), c]),
    );

    const seenSkuIds = new Set<string>();

    for (const extendable of [1, 0] as const) {
      let skus: SmsPoolRentalSku[] = [];
      try {
        skus = await this.smspool.listRentalSkus(extendable);
      } catch (error) {
        tally.errors.push(
          `rentals type=${extendable}:\n${(error as Error).message}`,
        );
        continue;
      }

      for (const sku of skus) {
        const country =
          countryByName.get(sku.name.toLowerCase()) ??
          countryByName.get((sku.tag ?? '').toLowerCase()) ??
          null;
        const code = country?.code ?? null;

        const saved = await this.prisma.smsRentalSku.upsert({
          where: { externalId: sku.ID },
          create: {
            externalId: sku.ID,
            name: sku.name,
            slug: externalSlug(sku.name, sku.ID),
            tag: sku.tag ?? null,
            region: sku.region ?? null,
            countryId: country?.id ?? null,
            countryCode: code,
            pool: sku.pool ?? null,
            extendable: extendable === 1,
            priority: sku.priority ?? 0,
            status: ProductStatus.DRAFT,
            lastSeenAt: runStartedAt,
          },
          update: {
            name: sku.name,
            tag: sku.tag ?? null,
            region: sku.region ?? null,
            countryId: country?.id ?? null,
            countryCode: code,
            pool: sku.pool ?? null,
            extendable: extendable === 1 ? true : undefined,
            priority: sku.priority ?? 0,
            lastSeenAt: runStartedAt,
          },
        });
        seenSkuIds.add(saved.id);
        tally.rentalSkusSynced += 1;

        const pricing = sku.pricing ?? {};
        const rule = this.pricing.resolveRule(rules, {
          pricingRuleId: saved.pricingRuleId,
          countryCode: code,
          rentalSkuId: saved.id,
        });

        for (const [daysRaw, costRaw] of Object.entries(pricing)) {
          const days = Number(daysRaw);
          const cost = new Prisma.Decimal(costRaw);
          if (!Number.isFinite(days) || days <= 0 || cost.lte(0)) continue;
          const priced = this.pricing.price(cost, rule);

          const prior = await this.prisma.smsRentalPlan.findUnique({
            where: {
              rentalSkuId_days: { rentalSkuId: saved.id, days },
            },
          });

          if (prior) {
            await this.prisma.smsRentalPlan.update({
              where: { id: prior.id },
              data: {
                providerCost: cost,
                lastSeenAt: runStartedAt,
                ...(prior.manualOverride
                  ? {}
                  : { retailPrice: priced.retailPrice }),
              },
            });
          } else {
            await this.prisma.smsRentalPlan.create({
              data: {
                rentalSkuId: saved.id,
                days,
                providerCost: cost,
                retailPrice: priced.retailPrice,
                status: ProductStatus.DRAFT,
                lastSeenAt: runStartedAt,
              },
            });
          }
          tally.rentalPlansSynced += 1;
        }
      }
    }

    void countryByCode;
    void slugify;
  }

  private async archiveStale(
    runStartedAt: Date,
    tally: SyncTally,
  ): Promise<void> {
    const liveOffers = await this.prisma.smsOneTimeOffer.count({
      where: { status: { not: ProductStatus.ARCHIVED } },
    });
    const staleOffers = await this.prisma.smsOneTimeOffer.count({
      where: {
        lastSeenAt: { lt: runStartedAt },
        status: { not: ProductStatus.ARCHIVED },
      },
    });

    if (
      liveOffers > 0 &&
      (staleOffers / liveOffers) * 100 > this.archiveMaxPercent
    ) {
      tally.sweepSkippedReason = `offer archive ${staleOffers}/${liveOffers} exceeds ${this.archiveMaxPercent}%`;
      opsAlert('smspool_archive_sweep_skipped', {
        reason: tally.sweepSkippedReason,
      });
      return;
    }

    const archivedOffers = await this.prisma.smsOneTimeOffer.updateMany({
      where: {
        lastSeenAt: { lt: runStartedAt },
        status: { not: ProductStatus.ARCHIVED },
      },
      data: { status: ProductStatus.ARCHIVED },
    });
    tally.offersArchived = archivedOffers.count;

    const archivedPlans = await this.prisma.smsRentalPlan.updateMany({
      where: {
        lastSeenAt: { lt: runStartedAt },
        status: { not: ProductStatus.ARCHIVED },
      },
      data: { status: ProductStatus.ARCHIVED },
    });
    tally.rentalPlansArchived = archivedPlans.count;

    // Silence unused import if chunk only used elsewhere
    void chunk;
  }
}
