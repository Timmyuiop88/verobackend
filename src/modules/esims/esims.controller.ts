import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
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
  @ApiOperation({
    summary: 'Get one eSIM: status + data balance in a single call',
  })
  @ApiOkResponse({ type: EsimAssetResponseDto })
  get(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<EsimAssetResponseDto> {
    return this.esimsService.getAssetForUser(user.id, id);
  }

  @Get(':id/topup-packages')
  @ApiOperation({
    summary: 'List available top-up packages for this eSIM, with pricing',
    description:
      'Always live from the provider (never cached) — this is the eligibility check and the exact price POST /esims/:id/topup will charge. An empty array means this eSIM cannot be topped up right now.',
  })
  @ApiOkResponse({ type: [TopUpPackageResponseDto] })
  listTopUpPackages(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<TopUpPackageResponseDto[]> {
    return this.esimsService.listTopUpPackagesForUser(user.id, id);
  }

  @Get(':id/topups')
  @ApiOperation({ summary: 'Top-up history for this eSIM' })
  @ApiOkResponse({ type: [OrderResponseDto] })
  listTopUps(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<OrderResponseDto[]> {
    return this.esimsService.listTopUpsForUser(user.id, id);
  }

  @Post(':id/topup')
  // Wallet-debiting endpoint — tighter limit than the global default.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Top up this eSIM with wallet balance',
    description: [
      'Send only `packageCode` from GET /esims/:id/topup-packages — the server re-fetches',
      'live eligibility and price from the provider and never trusts a client-supplied amount.',
      'Returns immediately with the order in FULFILLING status; poll GET /esims/:id or',
      'GET /orders/:id for completion, same as a fresh purchase.',
      'A 409 means a top-up for this eSIM is already in progress — wait for it to resolve first.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: OrderResponseDto })
  createTopUp(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateTopUpDto,
  ): Promise<OrderResponseDto> {
    return this.esimsService.createTopUp(user.id, id, dto.packageCode);
  }
}
