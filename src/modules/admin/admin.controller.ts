import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import {
  toAdminProductResponse,
  toTopUpProductResponse,
} from '../catalog/catalog.mapper';
import { CatalogService } from '../catalog/catalog.service';
import { ListAdminProductsQueryDto } from '../catalog/dto/list-products-query.dto';
import {
  AdminProductResponseDto,
  PaginatedAdminProductsResponseDto,
} from '../catalog/dto/product-response.dto';
import {
  TopUpProductResponseDto,
  TopUpSyncResultDto,
} from '../catalog/dto/topup-product-response.dto';
import { TopUpCatalogService } from '../catalog/topup-catalog.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import { OrderResponseDto } from '../orders/dto/order-response.dto';
import { toOrderResponse } from '../orders/orders.mapper';
import { OrdersService } from '../orders/orders.service';
import { WalletTransactionDto } from '../wallet/dto/wallet-response.dto';
import { WalletService } from '../wallet/wallet.service';
import {
  EsimWebhookConfigDto,
  RegisterEsimWebhookDto,
  SyncResultDto,
  UpdateProductPricingDto,
  UpdateProductStatusDto,
  UpdateTopUpEnabledDto,
  WalletAdjustDto,
} from './dto/admin.dto';

@ApiTags('admin')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description:
    'Admin role required (Clerk publicMetadata.role=admin or org:admin).',
})
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly topUpCatalogService: TopUpCatalogService,
    private readonly ordersService: OrdersService,
    private readonly walletService: WalletService,
    private readonly esimAccess: EsimAccessService,
  ) {}

  @Post('products/sync')
  @ApiOperation({
    summary: 'Sync supplier packages + regions into catalog',
    description: [
      '1) Syncs supported countries/regions from eSIM Access `POST /location/list` into `regions`.',
      '2) Pulls packages and upserts them as DRAFT products.',
      'Cost is converted from provider units to USD; retail uses the STANDARD pricing profile (unless `manualOverride`).',
      'Synced products are **not** visible publicly until published.',
      'After sync, use `GET /regions?q=` for country autocomplete and `GET /products?country=Japan` for search.',
      'See `TradeVero_docs/admin-product-sync.md`.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: SyncResultDto })
  syncProducts(): Promise<SyncResultDto> {
    return this.catalogService.syncFromProvider();
  }

  @Get('products')
  @ApiOperation({
    summary: 'List products including drafts (paginated)',
    description:
      'Admin catalog review queue. Filter by `status=DRAFT` to review items awaiting publish approval. Prices in USD (`costPriceUsd`, `retailPriceUsd`).',
  })
  @ApiOkResponse({ type: PaginatedAdminProductsResponseDto })
  async listProducts(
    @Query() query: ListAdminProductsQueryDto,
  ): Promise<PaginatedAdminProductsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const result = await this.catalogService.listAll({
      status: query.status,
      locationCode: query.locationCode,
      country: query.country,
      page,
      limit,
    });

    return {
      data: result.data.map(toAdminProductResponse),
      meta: buildPaginationMeta(result.page, result.limit, result.total),
    };
  }

  @Patch('products/:id/status')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary: 'Publish, unpublish, or archive a product (approval step)',
    description: [
      '**Approval = set status to `PUBLISHED`.**',
      '- `DRAFT` → `PUBLISHED`: product appears on `GET /products`',
      '- `PUBLISHED` → `DRAFT`: unpublish / revoke approval',
      '- `ARCHIVED`: hide permanently from public catalog',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async setStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProductStatusDto,
  ): Promise<AdminProductResponseDto> {
    const product = await this.catalogService.setStatus(id, dto.status);
    return toAdminProductResponse(product);
  }

  @Patch('products/:id/pricing')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary: 'Set pricing profile or manual retail price (USD)',
    description: [
      'Set `pricingProfileName` (`STANDARD` | `COMPETITIVE` | `PREMIUM`) to recalculate retail from cost.',
      'Or set `retailPrice` in USD dollars (e.g. `2.49`) for a manual override.',
      'Manual overrides are preserved across supplier syncs.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async setPricing(
    @Param('id') id: string,
    @Body() dto: UpdateProductPricingDto,
  ): Promise<AdminProductResponseDto> {
    const product = await this.catalogService.updatePricing({
      id,
      pricingProfileName: dto.pricingProfileName,
      retailPrice: dto.retailPrice,
      manualOverride: dto.manualOverride,
    });
    return toAdminProductResponse(product);
  }

  @Post('products/:id/topup-packages/sync')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary:
      '"Check top-up prices" — fetch this product\'s top-up tiers from the supplier',
    description: [
      "Queries eSIM Access `/package/list` by this product's packageCode (no live eSIM/iccid needed).",
      'Upserts results as DRAFT top-up tiers. Review with GET /admin/products/:id/topup-packages,',
      'adjust pricing, publish, then flip `topUpEnabled` on via PATCH /admin/products/:id/topup-enabled.',
      'An empty result means this product has no top-up tiers on the provider side.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: TopUpSyncResultDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  syncTopUpPackages(@Param('id') id: string): Promise<TopUpSyncResultDto> {
    return this.topUpCatalogService.syncForProduct(id);
  }

  @Get('products/:id/topup-packages')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary: 'Review top-up tiers for a product (DRAFT + PUBLISHED + ARCHIVED)',
  })
  @ApiOkResponse({ type: [TopUpProductResponseDto] })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async listTopUpPackages(
    @Param('id') id: string,
  ): Promise<TopUpProductResponseDto[]> {
    const topUps = await this.topUpCatalogService.listForProduct(id);
    return topUps.map(toTopUpProductResponse);
  }

  @Patch('products/:id/topup-enabled')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Product id' })
  @ApiOperation({
    summary: "Turn top-ups on/off for this product's eSIMs",
    description:
      'Kill switch — even with PUBLISHED tiers, GET /esims/:id/topup-packages returns nothing while this is false.',
  })
  @ApiOkResponse({ type: AdminProductResponseDto })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async setTopUpEnabled(
    @Param('id') id: string,
    @Body() dto: UpdateTopUpEnabledDto,
  ): Promise<AdminProductResponseDto> {
    const product = await this.topUpCatalogService.setTopUpEnabled(
      id,
      dto.enabled,
    );
    return toAdminProductResponse(product);
  }

  @Patch('topup-packages/:id/status')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'TopUpProduct id (from the sync/list response)',
  })
  @ApiOperation({
    summary: 'Publish, unpublish, or archive a top-up tier (approval step)',
  })
  @ApiOkResponse({ type: TopUpProductResponseDto })
  @ApiNotFoundResponse({ description: 'Top-up package not found' })
  async setTopUpPackageStatus(
    @Param('id') id: string,
    @Body() dto: UpdateProductStatusDto,
  ): Promise<TopUpProductResponseDto> {
    const topUp = await this.topUpCatalogService.setStatus(id, dto.status);
    return toTopUpProductResponse(topUp);
  }

  @Patch('topup-packages/:id/pricing')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'TopUpProduct id (from the sync/list response)',
  })
  @ApiOperation({
    summary:
      'Set pricing profile or manual retail price (USD) for a top-up tier',
  })
  @ApiOkResponse({ type: TopUpProductResponseDto })
  @ApiNotFoundResponse({ description: 'Top-up package not found' })
  async setTopUpPackagePricing(
    @Param('id') id: string,
    @Body() dto: UpdateProductPricingDto,
  ): Promise<TopUpProductResponseDto> {
    const topUp = await this.topUpCatalogService.updatePricing({
      id,
      pricingProfileName: dto.pricingProfileName,
      retailPrice: dto.retailPrice,
      manualOverride: dto.manualOverride,
    });
    return toTopUpProductResponse(topUp);
  }

  @Get('orders')
  @ApiOperation({ summary: 'List recent orders (admin)' })
  @ApiOkResponse({ type: [OrderResponseDto] })
  async listOrders(): Promise<OrderResponseDto[]> {
    const orders = await this.ordersService.listAll();
    return orders.map(toOrderResponse);
  }

  @Post('orders/:id/retry-fulfillment')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Order id' })
  @ApiOperation({
    summary: 'Force retry eSIM fulfillment for an order',
    description:
      'Re-enqueues the fulfillment job for an order stuck in FULFILLING (e.g. after the reconciliation sweep flags it, or for manual support intervention). No-op guard: refuses to retry orders already COMPLETED or REFUNDED.',
  })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  async retryFulfillment(@Param('id') id: string): Promise<OrderResponseDto> {
    const order = await this.ordersService.retryFulfillment(id);
    return toOrderResponse(order);
  }

  @Post('wallet/adjust')
  @ApiOperation({
    summary: 'Audited wallet adjustment (support)',
    description:
      'Requires Clerk admin role. Creates an ADJUSTMENT transaction with a signed USD `amount` (positive credits, negative debits) and updates the balance atomically.',
  })
  @ApiOkResponse({ type: WalletTransactionDto })
  @ApiNotFoundResponse({ description: 'User (or their wallet) not found' })
  async adjustWallet(
    @Body() dto: WalletAdjustDto,
  ): Promise<WalletTransactionDto> {
    const tx = await this.walletService.adjust({
      userId: dto.userId,
      amount: dto.amount,
      reference: `adjustment_${randomUUID()}`,
      metadata: { reason: dto.reason ?? 'admin_adjustment' },
    });

    return {
      id: tx.id,
      type: tx.type,
      amount: tx.amount.toString(),
      balanceAfter: tx.balanceAfter.toString(),
      reference: tx.reference,
      status: tx.status,
      createdAt: tx.createdAt,
    };
  }

  @Post('webhooks/esim-access')
  @ApiOperation({
    summary: 'Register eSIM Access webhook URL (use ngrok HTTPS in local)',
    description: [
      'Calls eSIM Access `POST /webhook/save`.',
      'Local: `ngrok http 3000` then register',
      '`https://<subdomain>.ngrok-free.app/api/v1/webhooks/esim-access`.',
      'Provider sends CHECK_HEALTH on save — our handler acknowledges it.',
      'See TradeVero_docs/esim-access-webhook-ngrok.md',
    ].join('\n'),
  })
  @ApiOkResponse({ type: EsimWebhookConfigDto })
  async registerEsimWebhook(
    @Body() dto: RegisterEsimWebhookDto,
  ): Promise<EsimWebhookConfigDto> {
    const saved = await this.esimAccess.saveWebhook(dto.webhookUrl);
    return { webhook: saved.webhook ?? dto.webhookUrl };
  }

  @Get('webhooks/esim-access')
  @ApiOperation({
    summary: 'Query currently registered eSIM Access webhook URL',
  })
  @ApiOkResponse({ type: EsimWebhookConfigDto })
  queryEsimWebhook(): Promise<EsimWebhookConfigDto> {
    return this.esimAccess.queryWebhook();
  }
}
