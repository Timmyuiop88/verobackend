import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GiftCardDenominationType,
  GiftCardSyncStatus,
  Prisma,
  ProductStatus,
  type GiftCardDenomination,
  type GiftCardPricingRule,
  type GiftCardProduct,
  type GiftCardSyncRun,
} from '@prisma/client';
import { opsAlert } from '../../common/observability/ops-alert';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env.schema';
import { ReloadlyService } from '../integrations/reloadly/reloadly.service';
import type { ReloadlyProduct } from '../integrations/reloadly/reloadly.types';
import { normalizeRecipientToSenderMap } from '../integrations/reloadly/reloadly.types';
import { GiftCardPricingService } from './giftcard-pricing.service';
import { SYNC_WRITE_BATCH_SIZE } from './giftcards.constants';
import { chunk, externalSlug, slugify } from './giftcards.util';

type SyncTally = {
  countriesSynced: number;
  categoriesSynced: number;
  brandsSynced: number;
  pagesFetched: number;
  productsSynced: number;
  productsCreated: number;
  productsUpdated: number;
  denominationsSynced: number;
  denominationsHidden: number;
  errors: string[];
};

type DenominationDraft = {
  faceValue: Prisma.Decimal;
  senderCost: Prisma.Decimal;
  sortOrder: number;
};

/**
 * Pulls the Reloadly catalog into our tables.
 *
 * Three things make this materially different from `CatalogService`
 * (the eSIM equivalent): the provider paginates ~13k products instead of
 * returning one flat list, a product is a parent of many buyable
 * denominations rather than a single SKU, and products get delisted often
 * enough that leaving stale rows published would mean selling cards
 * Reloadly will reject.
 *
 * Nothing is ever published automatically — new products land as DRAFT and
 * wait for an admin, exactly like the eSIM catalog.
 */
@Injectable()
export class GiftCardSyncService {
  private readonly logger = new Logger(GiftCardSyncService.name);
  private readonly pageSize: number;
  private readonly concurrency: number;
  private readonly archiveSweepMaxPercent: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reloadly: ReloadlyService,
    private readonly pricing: GiftCardPricingService,
    config: ConfigService<Env, true>,
  ) {
    this.pageSize = config.get('GIFTCARD_SYNC_PAGE_SIZE', { infer: true });
    this.concurrency = config.get('GIFTCARD_SYNC_CONCURRENCY', { infer: true });
    this.archiveSweepMaxPercent = config.get(
      'GIFTCARD_ARCHIVE_SWEEP_MAX_PERCENT',
      { infer: true },
    );
  }

  async startRun(trigger: string): Promise<GiftCardSyncRun> {
    return this.prisma.giftCardSyncRun.create({ data: { trigger } });
  }

  async run(runId: string): Promise<GiftCardSyncRun> {
    const run = await this.prisma.giftCardSyncRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const runStartedAt = run.startedAt;

    const tally: SyncTally = {
      countriesSynced: 0,
      categoriesSynced: 0,
      brandsSynced: 0,
      pagesFetched: 0,
      productsSynced: 0,
      productsCreated: 0,
      productsUpdated: 0,
      denominationsSynced: 0,
      denominationsHidden: 0,
      errors: [],
    };

    try {
      tally.countriesSynced = await this.syncCountries();
      tally.categoriesSynced = await this.syncCategories();
      await this.syncProducts(runStartedAt, tally);
    } catch (error) {
      this.logger.error('Gift card sync failed', error as Error);
      tally.errors.push(`fatal:${(error as Error).message}`);
      return this.finish(runId, tally, GiftCardSyncStatus.FAILED, null);
    }

    const sweep = await this.sweepStale(runStartedAt, tally);
    // Individual page failures still count as COMPLETED — the products that
    // did come back were written and are usable. `errors` and
    // `sweepSkippedReason` carry the nuance; FAILED is reserved for a run
    // that produced nothing.
    return this.finish(
      runId,
      tally,
      GiftCardSyncStatus.COMPLETED,
      sweep.skippedReason,
      sweep.productsArchived,
    );
  }

  private async finish(
    runId: string,
    tally: SyncTally,
    status: GiftCardSyncStatus,
    sweepSkippedReason: string | null,
    productsArchived = 0,
  ): Promise<GiftCardSyncRun> {
    if (tally.errors.length > 0) {
      opsAlert('giftcard_sync_completed_with_errors', {
        runId,
        errorCount: tally.errors.length,
        firstError: tally.errors[0],
      });
    }

    return this.prisma.giftCardSyncRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        countriesSynced: tally.countriesSynced,
        categoriesSynced: tally.categoriesSynced,
        brandsSynced: tally.brandsSynced,
        pagesFetched: tally.pagesFetched,
        productsSynced: tally.productsSynced,
        productsCreated: tally.productsCreated,
        productsUpdated: tally.productsUpdated,
        productsArchived,
        denominationsSynced: tally.denominationsSynced,
        denominationsHidden: tally.denominationsHidden,
        sweepSkippedReason,
        errors: tally.errors.length > 0 ? tally.errors : Prisma.DbNull,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------

  private async syncCountries(): Promise<number> {
    const countries = await this.reloadly.listCountries();

    for (const batch of chunk(countries, SYNC_WRITE_BATCH_SIZE)) {
      await this.prisma.$transaction(
        batch.map((country) => {
          const values = {
            name: country.name,
            continent: country.continent ?? null,
            currencyCode: country.currencyCode ?? null,
            currencyName: country.currencyName ?? null,
            currencySymbol: country.currencySymbol ?? null,
            flagUrl: country.flag ?? null,
            callingCodes: (country.callingCodes ?? []) as Prisma.InputJsonValue,
          };
          return this.prisma.giftCardCountry.upsert({
            where: { code: country.isoName },
            create: { code: country.isoName, ...values },
            update: values,
          });
        }),
      );
    }

    return countries.length;
  }

  private async syncCategories(): Promise<number> {
    const categories = await this.reloadly.listCategories();

    await this.prisma.$transaction(
      categories.map((category) =>
        this.prisma.giftCardCategory.upsert({
          where: { externalId: category.id },
          create: {
            externalId: category.id,
            name: category.name,
            slug: slugify(category.name),
          },
          // `slug` is intentionally not updated — it may already be used in
          // public URLs, and Reloadly renames categories occasionally.
          update: { name: category.name },
        }),
      ),
    );

    return categories.length;
  }

  // ---------------------------------------------------------------------
  // Products
  // ---------------------------------------------------------------------

  private async syncProducts(
    runStartedAt: Date,
    tally: SyncTally,
  ): Promise<void> {
    const rules = await this.pricing.loadRuleSet();
    const brandIds = new Map<number, string>();
    const categoryIds = new Map<number, string>();

    for (const category of await this.prisma.giftCardCategory.findMany({
      select: { id: true, externalId: true },
    })) {
      categoryIds.set(category.externalId, category.id);
    }
    for (const brand of await this.prisma.giftCardBrand.findMany({
      select: { id: true, externalId: true },
    })) {
      brandIds.set(brand.externalId, brand.id);
    }

    // Reloadly's `page` query parameter is 1-based even though the response
    // echoes a 0-based `number`. Do NOT pass `global: true` — that filter
    // returns only worldwide-redeemable products (often a single sandbox
    // SKU like PUBG Mobile), not "include globals alongside country cards".
    const firstPage = await this.reloadly.listProductsPage({
      page: 1,
      size: this.pageSize,
    });
    this.logger.log(
      `Gift card catalog page 1/${firstPage.totalPages}: ${firstPage.content.length} products (totalElements=${firstPage.totalElements})`,
    );
    tally.pagesFetched += 1;
    await this.processPage(firstPage.content, {
      runStartedAt,
      rules,
      brandIds,
      categoryIds,
      tally,
    });

    const totalPages = Math.max(firstPage.totalPages ?? 1, 1);
    const remaining: number[] = [];
    for (let page = 2; page <= totalPages; page += 1) {
      remaining.push(page);
    }

    for (const group of chunk(remaining, this.concurrency)) {
      const results = await Promise.all(
        group.map(async (page) => {
          try {
            const data = await this.reloadly.listProductsPage({
              page,
              size: this.pageSize,
            });
            return { page, data, error: null as Error | null };
          } catch (error) {
            return { page, data: null, error: error as Error };
          }
        }),
      );

      // Fetch pages in parallel but write them one at a time: concurrent
      // upserts across overlapping brands deadlock, and the brand cache is
      // shared mutable state.
      for (const result of results) {
        if (result.error || !result.data) {
          this.logger.warn(
            `Gift card product page ${result.page} failed: ${result.error?.message}`,
          );
          tally.errors.push(`page_${result.page}:${result.error?.message}`);
          continue;
        }
        tally.pagesFetched += 1;
        await this.processPage(result.data.content, {
          runStartedAt,
          rules,
          brandIds,
          categoryIds,
          tally,
        });
      }
    }
  }

  private async processPage(
    products: ReloadlyProduct[],
    context: {
      runStartedAt: Date;
      rules: GiftCardPricingRule[];
      brandIds: Map<number, string>;
      categoryIds: Map<number, string>;
      tally: SyncTally;
    },
  ): Promise<void> {
    if (products.length === 0) {
      return;
    }
    const { runStartedAt, rules, brandIds, categoryIds, tally } = context;

    await this.ensureBrands(products, brandIds, tally);

    const externalIds = products.map((product) => product.productId);
    const existing = await this.prisma.giftCardProduct.findMany({
      where: { externalProductId: { in: externalIds } },
      select: { id: true, externalProductId: true, status: true },
    });
    const existingByExternalId = new Map(
      existing.map((product) => [product.externalProductId, product]),
    );

    for (const batch of chunk(products, SYNC_WRITE_BATCH_SIZE)) {
      await this.prisma.$transaction(
        batch.map((product) => {
          const prior = existingByExternalId.get(product.productId);
          const isActive =
            (product.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE';

          const shared = {
            name: product.productName,
            brandId: product.brand
              ? (brandIds.get(product.brand.brandId) ?? null)
              : null,
            categoryId: product.category
              ? (categoryIds.get(product.category.id) ?? null)
              : null,
            countryCode: product.country?.isoName ?? null,
            global: product.global ?? false,
            providerStatus: product.status ?? null,
            denominationType:
              product.denominationType === 'RANGE'
                ? GiftCardDenominationType.RANGE
                : GiftCardDenominationType.FIXED,
            recipientCurrencyCode: product.recipientCurrencyCode ?? 'USD',
            senderCurrencyCode: product.senderCurrencyCode ?? 'USD',
            exchangeRate: new Prisma.Decimal(
              product.recipientCurrencyToSenderCurrencyExchangeRate ?? 1,
            ),
            senderFeePercentage: new Prisma.Decimal(
              product.senderFeePercentage ?? 0,
            ),
            senderFeeFixed: new Prisma.Decimal(
              product.senderFeePercentage ? 0 : (product.senderFee ?? 0),
            ),
            discountPercentage: new Prisma.Decimal(
              product.discountPercentage ?? 0,
            ),
            supportsPreOrder: product.supportsPreOrder ?? false,
            userIdRequired:
              product.additionalRequirements?.userIdRequired ?? false,
            logoUrls: (product.logoUrls ?? []) as Prisma.InputJsonValue,
            redeemInstructionConcise:
              product.redeemInstruction?.concise ?? null,
            redeemInstructionVerbose:
              product.redeemInstruction?.verbose ?? null,
            minRecipientDenomination: this.optionalDecimal(
              product.minRecipientDenomination,
            ),
            maxRecipientDenomination: this.optionalDecimal(
              product.maxRecipientDenomination ??
                product.maxrecipientDenomination,
            ),
            minSenderDenomination: this.optionalDecimal(
              product.minSenderDenomination,
            ),
            maxSenderDenomination: this.optionalDecimal(
              product.maxSenderDenomination,
            ),
            lastSeenAt: runStartedAt,
          };

          if (prior) {
            tally.productsUpdated += 1;
          } else {
            tally.productsCreated += 1;
          }

          return this.prisma.giftCardProduct.upsert({
            where: { externalProductId: product.productId },
            create: {
              externalProductId: product.productId,
              slug: externalSlug(product.productName, product.productId),
              status: ProductStatus.DRAFT,
              ...shared,
            },
            update: {
              ...shared,
              // Our curation state is preserved across syncs, except that a
              // product Reloadly has deactivated is pulled from sale
              // immediately — orders against it would fail anyway.
              ...(isActive || prior?.status !== ProductStatus.PUBLISHED
                ? {}
                : { status: ProductStatus.DRAFT }),
            },
          });
        }),
      );
    }

    tally.productsSynced += products.length;
    await this.syncDenominations(products, { runStartedAt, rules, tally });
  }

  private async ensureBrands(
    products: ReloadlyProduct[],
    brandIds: Map<number, string>,
    tally: SyncTally,
  ): Promise<void> {
    const unseen = new Map<
      number,
      { brandId: number; brandName: string; logoUrl?: string }
    >();
    for (const product of products) {
      if (product.brand && !brandIds.has(product.brand.brandId)) {
        unseen.set(product.brand.brandId, product.brand);
      }
    }
    if (unseen.size === 0) {
      return;
    }

    const brands = [...unseen.values()];
    for (const batch of chunk(brands, SYNC_WRITE_BATCH_SIZE)) {
      const saved = await this.prisma.$transaction(
        batch.map((brand) =>
          this.prisma.giftCardBrand.upsert({
            where: { externalId: brand.brandId },
            create: {
              externalId: brand.brandId,
              name: brand.brandName,
              slug: externalSlug(brand.brandName, brand.brandId),
              logoUrl: brand.logoUrl ?? null,
            },
            update: {
              name: brand.brandName,
              ...(brand.logoUrl ? { logoUrl: brand.logoUrl } : {}),
            },
          }),
        ),
      );
      for (const brand of saved) {
        brandIds.set(brand.externalId, brand.id);
      }
      tally.brandsSynced += saved.length;
    }
  }

  // ---------------------------------------------------------------------
  // Denominations
  // ---------------------------------------------------------------------

  private async syncDenominations(
    products: ReloadlyProduct[],
    context: {
      runStartedAt: Date;
      rules: GiftCardPricingRule[];
      tally: SyncTally;
    },
  ): Promise<void> {
    const { runStartedAt, rules, tally } = context;

    const stored = await this.prisma.giftCardProduct.findMany({
      where: {
        externalProductId: { in: products.map((p) => p.productId) },
      },
      select: {
        id: true,
        externalProductId: true,
        brandId: true,
        categoryId: true,
        countryCode: true,
        pricingRuleId: true,
        recipientCurrencyCode: true,
        senderCurrencyCode: true,
        exchangeRate: true,
        senderFeePercentage: true,
        senderFeeFixed: true,
        discountPercentage: true,
      },
    });
    const storedByExternalId = new Map(
      stored.map((product) => [product.externalProductId, product]),
    );

    const existingDenominations =
      await this.prisma.giftCardDenomination.findMany({
        where: { productId: { in: stored.map((product) => product.id) } },
        select: {
          id: true,
          productId: true,
          faceValue: true,
          manualOverride: true,
          status: true,
        },
      });
    const existingByKey = new Map(
      existingDenominations.map((denomination) => [
        `${denomination.productId}:${denomination.faceValue.toFixed(4)}`,
        denomination,
      ]),
    );

    const writes: Prisma.PrismaPromise<unknown>[] = [];
    const touchedProductIds: string[] = [];

    for (const product of products) {
      const row = storedByExternalId.get(product.productId);
      if (!row) {
        continue;
      }
      touchedProductIds.push(row.id);

      // RANGE products are stored (so the catalog is complete) but produce no
      // buyable rows until live FX pricing lands — see the phase 3 notes on
      // GiftCardRangeQuoteService.
      if (product.denominationType === 'RANGE') {
        continue;
      }

      const rule = this.pricing.resolveRule(rules, {
        pricingRuleId: row.pricingRuleId,
        productId: row.id,
        brandId: row.brandId,
        categoryId: row.categoryId,
        countryCode: row.countryCode,
      });

      for (const draft of this.buildDenominationDrafts(product)) {
        const priced = this.pricing.price(
          {
            faceValue: draft.faceValue,
            senderCost: draft.senderCost,
            senderFeePercentage: row.senderFeePercentage,
            senderFeeFixed: row.senderFeeFixed,
            discountPercentage: row.discountPercentage,
            recipientCurrencyCode: row.recipientCurrencyCode,
            senderCurrencyCode: row.senderCurrencyCode,
            exchangeRate: row.exchangeRate,
          },
          rule,
        );

        const key = `${row.id}:${draft.faceValue.toFixed(4)}`;
        const prior = existingByKey.get(key);

        const shared = {
          senderCost: draft.senderCost,
          feeAmount: priced.feeAmount,
          discountAmount: priced.discountAmount,
          netCost: priced.netCost,
          currency: row.senderCurrencyCode,
          viable: priced.viable,
          viabilityNote: priced.viabilityNote,
          sortOrder: draft.sortOrder,
          lastSeenAt: runStartedAt,
        };

        // A hand-set price survives the sync; everything else is recomputed.
        const repricing = prior?.manualOverride
          ? {}
          : { retailPrice: priced.retailPrice };

        // A denomination that stopped being profitable must not stay on sale.
        const demotion =
          !priced.viable && prior?.status === ProductStatus.PUBLISHED
            ? { status: ProductStatus.DRAFT }
            : {};

        writes.push(
          this.prisma.giftCardDenomination.upsert({
            where: {
              productId_faceValue: {
                productId: row.id,
                faceValue: draft.faceValue,
              },
            },
            create: {
              productId: row.id,
              faceValue: draft.faceValue,
              retailPrice: priced.retailPrice,
              status: ProductStatus.DRAFT,
              ...shared,
            },
            update: { ...shared, ...repricing, ...demotion },
          }),
        );
        tally.denominationsSynced += 1;
      }
    }

    for (const batch of chunk(writes, SYNC_WRITE_BATCH_SIZE)) {
      await this.prisma.$transaction(batch);
    }

    // Denominations the provider stopped offering for a product we did see
    // this run. Archived rather than deleted so historical orders still join.
    if (touchedProductIds.length > 0) {
      const hidden = await this.prisma.giftCardDenomination.updateMany({
        where: {
          productId: { in: touchedProductIds },
          lastSeenAt: { lt: runStartedAt },
          status: { not: ProductStatus.ARCHIVED },
        },
        data: { status: ProductStatus.ARCHIVED, viable: false },
      });
      tally.denominationsHidden += hidden.count;
    }
  }

  /**
   * Turns a FIXED product's denomination arrays into priced drafts. The
   * recipient→sender map is authoritative for cost; the parallel
   * `fixedSenderDenominations` array is only a positional fallback, and a
   * 1:1 assumption is the last resort.
   */
  private buildDenominationDrafts(
    product: ReloadlyProduct,
  ): DenominationDraft[] {
    const faceValues = product.fixedRecipientDenominations ?? [];
    const senderValues = product.fixedSenderDenominations ?? [];
    const normalizedMap = normalizeRecipientToSenderMap(
      product.fixedRecipientToSenderDenominationsMap,
    );

    const drafts: DenominationDraft[] = [];
    const seen = new Set<string>();

    faceValues.forEach((faceValue, index) => {
      if (!Number.isFinite(faceValue) || faceValue <= 0) {
        return;
      }
      const face = new Prisma.Decimal(faceValue).toDecimalPlaces(4);
      const key = face.toFixed(4);
      if (seen.has(key)) {
        return;
      }
      seen.add(key);

      const mapped = normalizedMap.get(key);
      const positional = senderValues[index];
      const senderCost = new Prisma.Decimal(
        mapped ?? (Number.isFinite(positional) ? positional : faceValue),
      ).toDecimalPlaces(4);

      drafts.push({ faceValue: face, senderCost, sortOrder: index });
    });

    return drafts;
  }

  private optionalDecimal(
    value: number | null | undefined,
  ): Prisma.Decimal | null {
    return value === null || value === undefined || !Number.isFinite(value)
      ? null
      : new Prisma.Decimal(value);
  }

  // ---------------------------------------------------------------------
  // Stale sweep
  // ---------------------------------------------------------------------

  /**
   * Archives anything the provider stopped listing. Two guards keep a bad
   * run from emptying the storefront: it refuses to run at all if any page
   * failed (a partial catalog looks identical to mass delisting), and it
   * aborts if the archive set exceeds a configured share of the catalog.
   */
  private async sweepStale(
    runStartedAt: Date,
    tally: SyncTally,
  ): Promise<{ productsArchived: number; skippedReason: string | null }> {
    if (tally.errors.length > 0) {
      const reason = `page_errors:${tally.errors.length}`;
      opsAlert('giftcard_sync_sweep_skipped', { reason });
      return { productsArchived: 0, skippedReason: reason };
    }

    const staleWhere: Prisma.GiftCardProductWhereInput = {
      lastSeenAt: { lt: runStartedAt },
      status: { not: ProductStatus.ARCHIVED },
    };

    const [staleCount, liveCount] = await Promise.all([
      this.prisma.giftCardProduct.count({ where: staleWhere }),
      this.prisma.giftCardProduct.count({
        where: { status: { not: ProductStatus.ARCHIVED } },
      }),
    ]);

    if (staleCount === 0) {
      return { productsArchived: 0, skippedReason: null };
    }

    const sharePercent = liveCount === 0 ? 100 : (staleCount / liveCount) * 100;
    if (sharePercent > this.archiveSweepMaxPercent) {
      const reason = `archive_share_too_high:${sharePercent.toFixed(1)}%>${this.archiveSweepMaxPercent}%`;
      opsAlert('giftcard_sync_sweep_skipped', {
        reason,
        staleCount,
        liveCount,
      });
      return { productsArchived: 0, skippedReason: reason };
    }

    const staleProducts = await this.prisma.giftCardProduct.findMany({
      where: staleWhere,
      select: { id: true },
    });
    const staleIds = staleProducts.map((product) => product.id);

    for (const batch of chunk(staleIds, 500)) {
      await this.prisma.$transaction([
        this.prisma.giftCardDenomination.updateMany({
          where: { productId: { in: batch } },
          data: { status: ProductStatus.ARCHIVED, viable: false },
        }),
        this.prisma.giftCardProduct.updateMany({
          where: { id: { in: batch } },
          data: { status: ProductStatus.ARCHIVED },
        }),
      ]);
    }

    this.logger.log(`Archived ${staleIds.length} delisted gift card products`);
    return { productsArchived: staleIds.length, skippedReason: null };
  }

  // ---------------------------------------------------------------------
  // Discount reconciliation
  // ---------------------------------------------------------------------

  /**
   * Refreshes commission rates from `GET /discounts`.
   *
   * Reloadly renegotiates discounts far more often than it changes the
   * catalog, and margin comes almost entirely from that number — a silent
   * drop from 8% to 2% turns a whole brand unprofitable. This is cheap
   * enough (a handful of pages) to run far more frequently than a full sync,
   * and it reprices only the products whose rate actually moved.
   */
  async reconcileDiscounts(): Promise<{
    checked: number;
    changed: number;
    denominationsRepriced: number;
    demoted: number;
  }> {
    const rules = await this.pricing.loadRuleSet();
    const changedProductIds: string[] = [];
    let checked = 0;
    let page = 1;
    let totalPages = 1;

    do {
      const result = await this.reloadly.listDiscountsPage({
        page,
        size: this.pageSize,
      });
      totalPages = result.totalPages ?? 1;

      for (const discount of result.content ?? []) {
        checked += 1;
        const rate = new Prisma.Decimal(discount.discountPercentage ?? 0);

        const product = await this.prisma.giftCardProduct.findUnique({
          where: { externalProductId: discount.product.productId },
          select: { id: true, discountPercentage: true },
        });
        if (!product || product.discountPercentage.eq(rate)) {
          continue;
        }

        await this.prisma.giftCardProduct.update({
          where: { id: product.id },
          data: { discountPercentage: rate },
        });
        changedProductIds.push(product.id);
      }

      page += 1;
    } while (page <= totalPages);

    const { repriced, demoted } = await this.repriceProducts(
      changedProductIds,
      rules,
    );

    if (demoted > 0) {
      opsAlert('giftcard_discount_drop_demoted_denominations', {
        products: changedProductIds.length,
        demoted,
      });
    }

    return {
      checked,
      changed: changedProductIds.length,
      denominationsRepriced: repriced,
      demoted,
    };
  }

  // ---------------------------------------------------------------------
  // Repricing (used after a pricing rule changes)
  // ---------------------------------------------------------------------

  /**
   * Recomputes retail for every non-overridden denomination without calling
   * the provider. Pricing rules change far more often than the catalog, and
   * a full sync to apply a margin tweak would be wasteful.
   */
  async repriceAll(): Promise<{ repriced: number; demoted: number }> {
    const rules = await this.pricing.loadRuleSet();
    let repriced = 0;
    let demoted = 0;
    let cursor: string | undefined;

    for (;;) {
      const products = await this.prisma.giftCardProduct.findMany({
        take: 200,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        orderBy: { id: 'asc' },
        where: { status: { not: ProductStatus.ARCHIVED } },
        include: { denominations: true },
      });
      if (products.length === 0) {
        break;
      }
      cursor = products[products.length - 1].id;

      const result = await this.applyRepricing(products, rules);
      repriced += result.repriced;
      demoted += result.demoted;
    }

    return { repriced, demoted };
  }

  private async repriceProducts(
    productIds: string[],
    rules: GiftCardPricingRule[],
  ): Promise<{ repriced: number; demoted: number }> {
    let repriced = 0;
    let demoted = 0;

    for (const batch of chunk(productIds, 200)) {
      const products = await this.prisma.giftCardProduct.findMany({
        where: { id: { in: batch } },
        include: { denominations: true },
      });
      const result = await this.applyRepricing(products, rules);
      repriced += result.repriced;
      demoted += result.demoted;
    }

    return { repriced, demoted };
  }

  private async applyRepricing(
    products: (GiftCardProduct & { denominations: GiftCardDenomination[] })[],
    rules: GiftCardPricingRule[],
  ): Promise<{ repriced: number; demoted: number }> {
    const writes: Prisma.PrismaPromise<unknown>[] = [];
    let repriced = 0;
    let demoted = 0;

    for (const product of products) {
      const rule = this.pricing.resolveRule(rules, {
        pricingRuleId: product.pricingRuleId,
        productId: product.id,
        brandId: product.brandId,
        categoryId: product.categoryId,
        countryCode: product.countryCode,
      });

      for (const denomination of product.denominations) {
        if (denomination.status === ProductStatus.ARCHIVED) {
          continue;
        }
        const priced = this.pricing.price(
          {
            faceValue: denomination.faceValue,
            senderCost: denomination.senderCost,
            senderFeePercentage: product.senderFeePercentage,
            senderFeeFixed: product.senderFeeFixed,
            discountPercentage: product.discountPercentage,
            recipientCurrencyCode: product.recipientCurrencyCode,
            senderCurrencyCode: product.senderCurrencyCode,
            exchangeRate: product.exchangeRate,
          },
          rule,
        );

        const demote =
          !priced.viable && denomination.status === ProductStatus.PUBLISHED;
        if (demote) {
          demoted += 1;
        }

        writes.push(
          this.prisma.giftCardDenomination.update({
            where: { id: denomination.id },
            data: {
              feeAmount: priced.feeAmount,
              discountAmount: priced.discountAmount,
              netCost: priced.netCost,
              viable: priced.viable,
              viabilityNote: priced.viabilityNote,
              ...(denomination.manualOverride
                ? {}
                : { retailPrice: priced.retailPrice }),
              ...(demote ? { status: ProductStatus.DRAFT } : {}),
            },
          }),
        );
        repriced += 1;
      }
    }

    for (const batch of chunk(writes, SYNC_WRITE_BATCH_SIZE)) {
      await this.prisma.$transaction(batch);
    }

    return { repriced, demoted };
  }
}
