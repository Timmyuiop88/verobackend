import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { GiftCardCatalogService } from './giftcard-catalog.service';
import { GiftCardOrdersService } from './giftcard-orders.service';
import { GiftCardRangeService } from './giftcard-range.service';
import {
  GIFTCARD_REVEAL_RATE_LIMIT,
  GIFTCARD_REVEAL_RATE_TTL_MS,
} from './giftcards.constants';
import {
  toGiftCardBrandDto,
  toGiftCardCategoryDto,
  toGiftCardCountryDto,
  toGiftCardDenominationDto,
  toGiftCardOrderResponse,
  toGiftCardProductDto,
  toGiftCardRevealResponse,
} from './giftcards.mapper';
import { CreateGiftCardOrderDto } from './dto/create-giftcard-order.dto';
import {
  GiftCardOrderResponseDto,
  GiftCardRevealResponseDto,
} from './dto/giftcard-order-response.dto';
import {
  GiftCardBrandDto,
  GiftCardCategoryDto,
  GiftCardCountryDto,
  GiftCardDenominationDto,
  GiftCardProductDto,
  PaginatedGiftCardsResponseDto,
} from './dto/giftcard-response.dto';
import {
  ListGiftCardsQueryDto,
  QuoteGiftCardQueryDto,
  SearchQueryDto,
} from './dto/list-giftcards-query.dto';

@ApiTags('giftcards')
@Controller('giftcards')
export class GiftCardsController {
  constructor(
    private readonly catalog: GiftCardCatalogService,
    private readonly orders: GiftCardOrdersService,
    private readonly range: GiftCardRangeService,
  ) {}

  @Get('countries')
  @ApiOperation({
    summary: 'List gift card countries',
    description:
      'Synced from Reloadly. Separate from `GET /regions`, which is the eSIM location list — the two providers use unrelated code sets.',
  })
  @ApiOkResponse({ type: [GiftCardCountryDto] })
  async listCountries(
    @Query() query: SearchQueryDto,
  ): Promise<GiftCardCountryDto[]> {
    const countries = await this.catalog.listCountries(query.q);
    return countries.map(toGiftCardCountryDto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List gift card categories' })
  @ApiOkResponse({ type: [GiftCardCategoryDto] })
  async listCategories(): Promise<GiftCardCategoryDto[]> {
    const categories = await this.catalog.listCategories();
    return categories.map(toGiftCardCategoryDto);
  }

  @Get('brands')
  @ApiOperation({ summary: 'List gift card brands (autocomplete)' })
  @ApiOkResponse({ type: [GiftCardBrandDto] })
  async listBrands(
    @Query() query: SearchQueryDto,
  ): Promise<GiftCardBrandDto[]> {
    const brands = await this.catalog.listBrands(query.q);
    return brands.map(toGiftCardBrandDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Browse published gift cards (paginated)',
    description: [
      'Only products with at least one published, profitable denomination are returned.',
      'Each product carries its buyable `denominations` — buy one by posting its `id` to `POST /giftcards/orders`.',
      'Prices are USD; `savings` is set when a card sells below face value.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: PaginatedGiftCardsResponseDto })
  async list(
    @Query() query: ListGiftCardsQueryDto,
  ): Promise<PaginatedGiftCardsResponseDto> {
    const result = await this.catalog.listPublished({
      q: query.q,
      countryCode: query.countryCode,
      categorySlug: query.categorySlug,
      brandSlug: query.brandSlug,
      global: query.global,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });

    return {
      data: result.data.map(toGiftCardProductDto),
      meta: buildPaginationMeta(result.page, result.limit, result.total),
    };
  }

  @Get('orders')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiOperation({ summary: 'List my gift card orders' })
  @ApiOkResponse({ type: [GiftCardOrderResponseDto] })
  async listOrders(
    @CurrentUser() user: User,
  ): Promise<GiftCardOrderResponseDto[]> {
    const orders = await this.orders.listForUser(user.id);
    return orders.map(toGiftCardOrderResponse);
  }

  @Get('orders/:id')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @ApiParam({ name: 'id', format: 'uuid', description: 'Gift card order id' })
  @ApiOperation({ summary: 'Get one of my gift card orders' })
  @ApiOkResponse({ type: GiftCardOrderResponseDto })
  @ApiNotFoundResponse({ description: 'Order not found' })
  @ApiForbiddenResponse({ description: 'Order belongs to another user' })
  async getOrder(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<GiftCardOrderResponseDto> {
    const order = await this.orders.getForUser(user.id, id);
    return toGiftCardOrderResponse(order);
  }

  @Post('orders')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  // Wallet-debiting endpoint — same tighter budget as eSIM purchases.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Buy a gift card with wallet balance',
    description: [
      'Debits the wallet immediately and queues the Reloadly order.',
      'Returns with status `FULFILLING` — poll `GET /giftcards/orders/:id` until `codeAvailable` is true,',
      'then call `POST /giftcards/orders/:id/reveal` to read the code.',
      'Failures are refunded automatically in full.',
    ].join('\n'),
  })
  @ApiCreatedResponse({ type: GiftCardOrderResponseDto })
  @ApiBadRequestResponse({
    description:
      'Insufficient wallet balance, or a required user ID is missing',
  })
  @ApiNotFoundResponse({ description: 'Denomination is not available' })
  async createOrder(
    @CurrentUser() user: User,
    @Body() dto: CreateGiftCardOrderDto,
  ): Promise<GiftCardOrderResponseDto> {
    const order = await this.orders.create(user, {
      denominationId: dto.denominationId,
      recipientEmail: dto.recipientEmail,
      externalUserId: dto.externalUserId,
    });
    return toGiftCardOrderResponse(order);
  }

  @Post('orders/:id/reveal')
  @ApiBearerAuth()
  @UseGuards(ClerkAuthGuard)
  @Throttle({
    default: {
      limit: GIFTCARD_REVEAL_RATE_LIMIT,
      ttl: GIFTCARD_REVEAL_RATE_TTL_MS,
    },
  })
  @ApiParam({ name: 'id', format: 'uuid', description: 'Gift card order id' })
  @ApiOperation({
    summary: 'Reveal the card number and PIN',
    description: [
      'The only endpoint that returns card codes. POST rather than GET so the code never lands in',
      'server logs, browser history, or a referer header.',
      'Every call is counted and timestamped on the order, and the route is rate limited separately.',
      'Codes are bearer instruments — display them once, behind an explicit user action.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: GiftCardRevealResponseDto })
  @ApiBadRequestResponse({ description: 'Order has not completed yet' })
  @ApiNotFoundResponse({
    description: 'Order not found, or no code stored yet',
  })
  @ApiForbiddenResponse({ description: 'Order belongs to another user' })
  async reveal(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<GiftCardRevealResponseDto> {
    const result = await this.orders.reveal(user.id, id);
    return toGiftCardRevealResponse(result);
  }

  @Get(':idOrSlug/quote')
  @ApiParam({
    name: 'idOrSlug',
    description: 'Custom-amount (RANGE) product uuid or slug',
  })
  @ApiOperation({
    summary: 'Price a custom amount on a custom-amount gift card',
    description: [
      'For products with `denominationType: RANGE`, where the customer names the amount.',
      'Returns a real denomination — post its `id` to `POST /giftcards/orders` exactly like a fixed one.',
      "Amounts must be whole units and within the product's range. Quotes are priced live, so re-quote before buying if the user lingers.",
    ].join('\n'),
  })
  @ApiOkResponse({ type: GiftCardDenominationDto })
  @ApiBadRequestResponse({
    description:
      'Amount out of range, not a whole number, or cannot be sold profitably',
  })
  async quote(
    @Param('idOrSlug') idOrSlug: string,
    @Query() query: QuoteGiftCardQueryDto,
  ): Promise<GiftCardDenominationDto> {
    const { denomination } = await this.range.quote({
      idOrSlug,
      amount: query.amount,
    });
    return toGiftCardDenominationDto(denomination);
  }

  @Get(':idOrSlug')
  @ApiParam({
    name: 'idOrSlug',
    description: 'Product uuid or slug (e.g. `amazon-us-1`)',
  })
  @ApiOperation({
    summary: 'Get a published gift card with its buyable denominations',
  })
  @ApiOkResponse({ type: GiftCardProductDto })
  @ApiNotFoundResponse({ description: 'Gift card not found or not published' })
  async get(@Param('idOrSlug') idOrSlug: string): Promise<GiftCardProductDto> {
    const product = await this.catalog.getPublished(idOrSlug);
    return toGiftCardProductDto(product);
  }
}
