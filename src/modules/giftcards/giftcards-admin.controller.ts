import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { ReloadlyService } from '../integrations/reloadly/reloadly.service';
import { GiftCardCatalogService } from './giftcard-catalog.service';
import { GiftCardOrdersService } from './giftcard-orders.service';
import { GiftCardPricingService } from './giftcard-pricing.service';
import { GiftCardSyncScheduler } from './giftcard-sync.scheduler';
import { GiftCardSyncService } from './giftcard-sync.service';
import {
  toAdminGiftCardDenominationDto,
  toAdminGiftCardProductDto,
  toGiftCardOrderResponse,
  toGiftCardPricingRuleDto,
  toGiftCardSyncRunDto,
} from './giftcards.mapper';
import {
  AssignPricingRuleDto,
  DiscountReconcileResultDto,
  GiftCardBalanceDto,
  GiftCardPricingRuleDto,
  GiftCardSyncRunDto,
  MarginReportDto,
  MarginReportQueryDto,
  RepriceResultDto,
  UpdateGiftCardPriceDto,
  UpdateGiftCardStatusDto,
  UpsertGiftCardPricingRuleDto,
} from './dto/giftcard-admin.dto';
import { GiftCardOrderResponseDto } from './dto/giftcard-order-response.dto';
import {
  AdminGiftCardDenominationDto,
  AdminGiftCardProductDto,
  PaginatedAdminGiftCardsResponseDto,
} from './dto/giftcard-response.dto';
import { ListAdminGiftCardsQueryDto } from './dto/list-giftcards-query.dto';

@ApiTags('admin')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description:
    'Admin role required (Clerk publicMetadata.role=admin or org:admin).',
})
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/giftcards')
export class GiftCardsAdminController {
  constructor(
    private readonly catalog: GiftCardCatalogService,
    private readonly pricing: GiftCardPricingService,
    private readonly syncService: GiftCardSyncService,
    private readonly scheduler: GiftCardSyncScheduler,
    private readonly orders: GiftCardOrdersService,
    private readonly reloadly: ReloadlyService,
  ) {}

  // -------------------------------------------------------------------
  // Sync
  // -------------------------------------------------------------------

  @Post('sync')
  @ApiOperation({
    summary: 'Start a Reloadly catalog sync (async)',
    description: [
      'Queues a full walk of Reloadly countries, categories, brands, products and FIXED denominations.',
      'Returns immediately with a run id — the walk takes minutes across ~70 paginated requests,',
      'unlike the eSIM sync which is a single inline call.',
      'Poll `GET /admin/giftcards/sync-runs/:id` for progress.',
      'Everything lands as DRAFT; nothing becomes buyable until published.',
      'Calling this while a run is in flight returns the existing run instead of starting a second.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: GiftCardSyncRunDto })
  async startSync(): Promise<GiftCardSyncRunDto> {
    const run = await this.scheduler.enqueue('admin');
    return toGiftCardSyncRunDto(run);
  }

  @Get('sync-runs')
  @ApiOperation({
    summary: 'Recent catalog sync runs',
    description:
      'Audit trail. Check `errors` and `sweepSkippedReason` — a skipped sweep means stale products were left published on purpose.',
  })
  @ApiOkResponse({ type: [GiftCardSyncRunDto] })
  async listSyncRuns(): Promise<GiftCardSyncRunDto[]> {
    const runs = await this.catalog.listSyncRuns();
    return runs.map(toGiftCardSyncRunDto);
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Reloadly prepaid balance',
    description:
      'Reloadly is prepaid — an empty balance fails every gift card order. Top up before it runs out.',
  })
  @ApiOkResponse({ type: GiftCardBalanceDto })
  async balance(): Promise<GiftCardBalanceDto> {
    const balance = await this.reloadly.getBalance();
    return {
      balance: balance.balance,
      currencyCode: balance.currencyCode,
      low: balance.balance < this.reloadly.minimumBalanceAlertThreshold,
    };
  }

  // -------------------------------------------------------------------
  // Pricing
  // -------------------------------------------------------------------

  @Get('pricing-rules')
  @ApiOperation({
    summary: 'List pricing rules',
    description: [
      'Resolution is most-specific-wins: PRODUCT → BRAND → CATEGORY → COUNTRY → GLOBAL.',
      'retail = max(netCost x (1 + minMargin), face x (1 - customerDiscount)), rejected above face x (1 + maxOverFace).',
    ].join('\n'),
  })
  @ApiOkResponse({ type: [GiftCardPricingRuleDto] })
  async listPricingRules(): Promise<GiftCardPricingRuleDto[]> {
    const rules = await this.pricing.listRules();
    return rules.map(toGiftCardPricingRuleDto);
  }

  @Put('pricing-rules')
  @ApiOperation({
    summary: 'Create or update a pricing rule',
    description:
      'Upserts by (scope, scopeRef). Run `POST /admin/giftcards/reprice` afterwards to apply it to the existing catalog.',
  })
  @ApiOkResponse({ type: GiftCardPricingRuleDto })
  async upsertPricingRule(
    @Body() dto: UpsertGiftCardPricingRuleDto,
  ): Promise<GiftCardPricingRuleDto> {
    const rule = await this.pricing.upsertRule(dto);
    return toGiftCardPricingRuleDto(rule);
  }

  @Delete('pricing-rules/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Delete a pricing rule (the GLOBAL fallback cannot be deleted)',
  })
  @ApiOkResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Rule not found' })
  async deletePricingRule(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.pricing.deleteRule(id);
    return { deleted: true };
  }

  @Post('reprice')
  @ApiOperation({
    summary: 'Recompute retail prices from the current rules',
    description: [
      'Reprices every non-archived, non-overridden denomination without touching Reloadly.',
      'Published denominations that stopped being profitable are pulled back to DRAFT.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: RepriceResultDto })
  reprice(): Promise<RepriceResultDto> {
    return this.syncService.repriceAll();
  }

  @Post('reconcile-discounts')
  @ApiOperation({
    summary: "Refresh Reloadly's commission rates and reprice what moved",
    description: [
      'Reads `GET /discounts` and updates any product whose commission changed, then reprices only those.',
      'Margin is almost entirely commission, so a rate cut can quietly turn a brand unprofitable — this is',
      'much cheaper than a full catalog sync and worth running far more often.',
      'Published denominations that stop clearing the margin floor are pulled back to DRAFT.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: DiscountReconcileResultDto })
  reconcileDiscounts(): Promise<DiscountReconcileResultDto> {
    return this.syncService.reconcileDiscounts();
  }

  // -------------------------------------------------------------------
  // Orders
  // -------------------------------------------------------------------

  @Get('orders')
  @ApiOperation({ summary: 'List recent gift card orders' })
  @ApiOkResponse({ type: [GiftCardOrderResponseDto] })
  async listOrders(): Promise<GiftCardOrderResponseDto[]> {
    const orders = await this.orders.listAll();
    return orders.map(toGiftCardOrderResponse);
  }

  @Post('orders/:id/retry')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({
    summary: 'Re-enqueue fulfillment for a stuck gift card order',
    description:
      'Safe to call: the worker reconciles against the order id (sent to Reloadly as `customIdentifier`) before it would place a second order.',
  })
  @ApiOkResponse({ type: GiftCardOrderResponseDto })
  @ApiBadRequestResponse({
    description: 'Order is already COMPLETED or REFUNDED',
  })
  @ApiNotFoundResponse({ description: 'Order not found' })
  async retryOrder(@Param('id') id: string): Promise<GiftCardOrderResponseDto> {
    const order = await this.orders.retryFulfillment(id);
    return toGiftCardOrderResponse(order);
  }

  @Get('margin-report')
  @ApiOperation({
    summary: 'Realized margin on issued gift cards',
    description:
      "Computed from Reloadly's own transaction figures rather than catalog prices, so it reflects the fees and commission actually applied. `negativeMarginOrders` above zero means a pricing rule needs attention.",
  })
  @ApiOkResponse({ type: MarginReportDto })
  marginReport(@Query() query: MarginReportQueryDto): Promise<MarginReportDto> {
    return this.orders.marginReport({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  // -------------------------------------------------------------------
  // Denominations
  // -------------------------------------------------------------------

  @Patch('denominations/:id/status')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Denomination id' })
  @ApiOperation({
    summary: 'Publish, unpublish, or archive a single denomination',
    description:
      'Publishing a non-viable denomination is refused — set a manual price first if you intend to sell it thin.',
  })
  @ApiOkResponse({ type: AdminGiftCardDenominationDto })
  @ApiBadRequestResponse({ description: 'Denomination is not viable' })
  @ApiNotFoundResponse({ description: 'Denomination not found' })
  async setDenominationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateGiftCardStatusDto,
  ): Promise<AdminGiftCardDenominationDto> {
    const denomination = await this.catalog.setDenominationStatus(
      id,
      dto.status,
    );
    return toAdminGiftCardDenominationDto(denomination);
  }

  @Patch('denominations/:id/price')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Denomination id' })
  @ApiOperation({
    summary: 'Set a manual retail price (USD)',
    description:
      'Marks the denomination as manually overridden so syncs and repricing leave it alone.',
  })
  @ApiOkResponse({ type: AdminGiftCardDenominationDto })
  @ApiNotFoundResponse({ description: 'Denomination not found' })
  async setDenominationPrice(
    @Param('id') id: string,
    @Body() dto: UpdateGiftCardPriceDto,
  ): Promise<AdminGiftCardDenominationDto> {
    const denomination = await this.catalog.setDenominationPrice({
      id,
      retailPrice: dto.retailPrice,
    });
    return toAdminGiftCardDenominationDto(denomination);
  }

  // -------------------------------------------------------------------
  // Products (declared last so the static routes above win)
  // -------------------------------------------------------------------

  @Get()
  @ApiOperation({
    summary: 'List gift card products including drafts (paginated)',
    description:
      'Review queue. `status=DRAFT&viableOnly=true` is the shortlist worth publishing — products with at least one profitable denomination.',
  })
  @ApiOkResponse({ type: PaginatedAdminGiftCardsResponseDto })
  async listProducts(
    @Query() query: ListAdminGiftCardsQueryDto,
  ): Promise<PaginatedAdminGiftCardsResponseDto> {
    const result = await this.catalog.listAll({
      status: query.status,
      q: query.q,
      countryCode: query.countryCode,
      categorySlug: query.categorySlug,
      viableOnly: query.viableOnly,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });

    return {
      data: result.data.map(toAdminGiftCardProductDto),
      meta: buildPaginationMeta(result.page, result.limit, result.total),
    };
  }

  @Get('sync-runs/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Progress of one sync run' })
  @ApiOkResponse({ type: GiftCardSyncRunDto })
  @ApiNotFoundResponse({ description: 'Sync run not found' })
  async getSyncRun(@Param('id') id: string): Promise<GiftCardSyncRunDto> {
    return toGiftCardSyncRunDto(await this.catalog.getSyncRun(id));
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({ summary: 'Get one gift card product with all denominations' })
  @ApiOkResponse({ type: AdminGiftCardProductDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async getProduct(@Param('id') id: string): Promise<AdminGiftCardProductDto> {
    const product = await this.catalog.getForAdmin(id);
    return toAdminGiftCardProductDto(product);
  }

  @Patch(':id/status')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary: 'Publish, unpublish, or archive a gift card product',
    description: [
      '**Approval = set status to `PUBLISHED`.**',
      'By default this cascades to the denominations; when publishing, only viable ones are included',
      'so an unprofitable tier never goes on sale by accident.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminGiftCardProductDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async setProductStatus(
    @Param('id') id: string,
    @Body() dto: UpdateGiftCardStatusDto,
  ): Promise<AdminGiftCardProductDto> {
    const product = await this.catalog.setProductStatus(
      id,
      dto.status,
      dto.cascade ?? true,
    );
    return toAdminGiftCardProductDto(product);
  }

  @Patch(':id/pricing-rule')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary: 'Pin this product to a specific pricing rule',
    description:
      'Overrides the scope chain for this product only. Send `null` to clear. Reprice afterwards to apply.',
  })
  @ApiOkResponse({ type: AdminGiftCardProductDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async assignPricingRule(
    @Param('id') id: string,
    @Body() dto: AssignPricingRuleDto,
  ): Promise<AdminGiftCardProductDto> {
    const product = await this.catalog.assignPricingRule(
      id,
      dto.pricingRuleId ?? null,
    );
    return toAdminGiftCardProductDto(product);
  }
}
