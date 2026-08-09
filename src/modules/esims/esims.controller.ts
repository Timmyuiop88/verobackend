import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { OrderResponseDto } from '../orders/dto/order-response.dto';
import { CreateTopUpDto } from './dto/create-topup.dto';
import { EsimAssetResponseDto } from './dto/esim-asset-response.dto';
import { TopUpPackageResponseDto } from './dto/topup-package-response.dto';
import { EsimsService } from './esims.service';

/**
 * Asset-shaped read/action surface over the underlying Order/ProviderOrder
 * tables — "my eSIMs" instead of "my orders". Purchases still go through
 * POST /orders; this module owns everything that happens to an eSIM
 * afterwards (viewing balance/status, and topping it up).
 */
@ApiTags('esims')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('esims')
export class EsimsController {
  constructor(private readonly esimsService: EsimsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my eSIMs (one per completed/in-progress purchase)',
  })
  @ApiOkResponse({ type: [EsimAssetResponseDto] })
  list(@CurrentUser() user: User): Promise<EsimAssetResponseDto[]> {
    return this.esimsService.listAssetsForUser(user.id);
  }

  @Get(':id')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'eSIM id (ProviderOrder id, from GET /esims)',
  })
  @ApiOperation({
    summary: 'Get one eSIM: status + data balance in a single call',
  })
  @ApiOkResponse({ type: EsimAssetResponseDto })
  @ApiNotFoundResponse({ description: 'eSIM not found' })
  @ApiForbiddenResponse({ description: 'eSIM belongs to another user' })
  get(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<EsimAssetResponseDto> {
    return this.esimsService.getAssetForUser(user.id, id);
  }

  @Get(':id/topup-packages')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'eSIM id (ProviderOrder id, from GET /esims)',
  })
  @ApiOperation({
    summary: 'List available top-up packages for this eSIM, with pricing',
    description: [
      'Admin-curated and approved (not a live provider call) — fast DB read of PUBLISHED',
      'top-up tiers for the product this eSIM was sold under. An empty array means either',
      'the eSIM is not ready yet, or top-ups are not enabled/published for this plan.',
      'POST /esims/:id/topup still performs one live provider check right before charging.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: [TopUpPackageResponseDto] })
  @ApiNotFoundResponse({ description: 'eSIM not found' })
  @ApiForbiddenResponse({ description: 'eSIM belongs to another user' })
  @ApiBadRequestResponse({ description: 'eSIM not ready yet (no iccid)' })
  listTopUpPackages(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<TopUpPackageResponseDto[]> {
    return this.esimsService.listTopUpPackagesForUser(user.id, id);
  }

  @Get(':id/topups')
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'eSIM id (ProviderOrder id, from GET /esims)',
  })
  @ApiOperation({ summary: 'Top-up history for this eSIM' })
  @ApiOkResponse({ type: [OrderResponseDto] })
  @ApiNotFoundResponse({ description: 'eSIM not found' })
  @ApiForbiddenResponse({ description: 'eSIM belongs to another user' })
  listTopUps(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<OrderResponseDto[]> {
    return this.esimsService.listTopUpsForUser(user.id, id);
  }

  @Post(':id/topup')
  // Wallet-debiting endpoint — tighter limit than the global default.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiParam({
    name: 'id',
    format: 'uuid',
    description: 'eSIM id (ProviderOrder id, from GET /esims)',
  })
  @ApiOperation({
    summary: 'Top up this eSIM with wallet balance',
    description: [
      'Send only `packageCode` from GET /esims/:id/topup-packages — the server charges the',
      'admin-approved stored price and never trusts a client-supplied amount. One final live',
      'provider check (by iccid) still runs right before charging as a per-instance eligibility gate.',
      'Returns immediately with the order in FULFILLING status; poll GET /esims/:id or',
      'GET /orders/:id for completion, same as a fresh purchase.',
      'A 409 means a top-up for this eSIM is already in progress — wait for it to resolve first.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  @ApiNotFoundResponse({ description: 'eSIM not found' })
  @ApiForbiddenResponse({ description: 'eSIM belongs to another user' })
  @ApiBadRequestResponse({
    description:
      'eSIM not ready, top-ups not enabled for this product, package not published, or the live per-instance eligibility check failed',
  })
  @ApiConflictResponse({
    description: 'A top-up is already in progress for this eSIM',
  })
  createTopUp(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateTopUpDto,
  ): Promise<OrderResponseDto> {
    return this.esimsService.createTopUp(user.id, id, dto.packageCode);
  }
}
