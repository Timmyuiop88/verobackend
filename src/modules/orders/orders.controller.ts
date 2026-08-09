import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  esimBuyDebug,
  esimBuyDebugError,
} from '../../common/debug/esim-buy-debug';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { EsimInstallDetailsResponseDto } from './dto/install-details-response.dto';
import {
  OrderResponseDto,
  OrderUsageResponseDto,
} from './dto/order-response.dto';
import { toOrderResponse } from './orders.mapper';
import { OrdersService } from './orders.service';
import { UsageService } from '../usage/usage.service';

@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly usageService: UsageService,
  ) {}

  @Post()
  // Wallet-debiting endpoint — tighter limit than the global default to
  // blunt rapid-fire double-submits/abuse beyond normal usage.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Purchase a published product with wallet balance',
    description:
      'Debits the wallet immediately and enqueues eSIM provisioning. Returns with status PAID/FULFILLING — poll GET /orders/:id (or GET /esims once allocated) for completion.',
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiBadRequestResponse({ description: 'Insufficient wallet balance' })
  @ApiNotFoundResponse({ description: 'Published product not found' })
  async create(
    @CurrentUser() user: User,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    // TEMP: remove [ESIM_BUY_DEBUG] tracing when purchase flow is stable
    esimBuyDebug('1.request.received', {
      userId: user.id,
      email: user.email,
      productId: dto.productId,
    });
    try {
      const order = await this.ordersService.create(user, dto.productId);
      esimBuyDebug('1.request.accepted', {
        orderId: order.id,
        status: order.status,
        amount: order.amount.toString(),
      });
      return toOrderResponse(order);
    } catch (error) {
      esimBuyDebugError('1.request.failed', error, {
        userId: user.id,
        productId: dto.productId,
      });
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'List my orders' })
  @ApiOkResponse({ type: [OrderResponseDto] })
  async list(@CurrentUser() user: User): Promise<OrderResponseDto[]> {
    const orders = await this.ordersService.listForUser(user.id);
    return orders.map(toOrderResponse);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Order id' })
  @ApiOperation({ summary: 'Get my order by id' })
  @ApiOkResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Order belongs to another user' })
  async get(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<OrderResponseDto> {
    const order = await this.ordersService.getForUser(user.id, id);
    return toOrderResponse(order);
  }

  @Get(':id/usage')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Order id' })
  @ApiOperation({
    summary: 'Get eSIM data usage/balance for my order',
    description: [
      'Returns `dataUsedBytes`, `dataTotalBytes`, and the pre-computed `dataRemainingBytes` / `dataUsedPercent`.',
      'Served from our DB with a stale-while-revalidate refresh (`lastSyncedAt` older than 15 min triggers a background refresh).',
      'Note: eSIM Access only updates usage on their end every 2-3 hours — see `isProviderDataRealtime`.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: OrderUsageResponseDto })
  @ApiNotFoundResponse({
    description: 'Order not found, or eSIM not allocated yet',
  })
  @ApiForbiddenResponse({ description: 'Order belongs to another user' })
  getUsage(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<OrderUsageResponseDto> {
    return this.usageService.getUsageForOrder(user.id, id);
  }

  @Get(':id/install')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Order id' })
  @ApiOperation({
    summary: 'Get everything needed to install this eSIM on a device',
    description: [
      'Call once `GET /orders/:id` shows a non-empty `esim.iccid` (i.e. status is past FULFILLING).',
      'Returns the QR code, the raw LPA activation code (plus it pre-parsed into',
      '`smdpAddress`/`matchingId` for manual-entry forms), an `iosInstallUrl` for one-tap',
      'installs on iOS 17.4+ Safari, and manual APN/PIN/PUK fallback fields if the device needs them.',
      'See `TradeVero_docs/esim-install-flow.md` for the recommended UI flow.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: EsimInstallDetailsResponseDto })
  @ApiNotFoundResponse({
    description: 'Order not found, or eSIM not allocated yet',
  })
  @ApiForbiddenResponse({ description: 'Order belongs to another user' })
  getInstallDetails(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<EsimInstallDetailsResponseDto> {
    return this.ordersService.getInstallDetailsForUser(user.id, id);
  }
}
