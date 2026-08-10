import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import {
  CreateNumberRentalDto,
  CreateSmsVerificationDto,
  ExtendNumberRentalDto,
  ListSmsOffersQueryDto,
  ListSmsRentalsQueryDto,
  ListSmsServicesQueryDto,
} from './dto/sms.dto';
import { SmsCatalogService } from './sms-catalog.service';
import { SmsOrdersService } from './sms-orders.service';
import {
  toRentalDto,
  toSmsCountryDto,
  toSmsOfferDto,
  toSmsRentalSkuDto,
  toSmsServiceDto,
  toVerificationOrderDto,
} from './sms.mapper';

@ApiTags('sms')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('sms')
export class SmsController {
  constructor(
    private readonly catalog: SmsCatalogService,
    private readonly orders: SmsOrdersService,
  ) {}

  @Get('countries')
  @ApiOperation({ summary: 'List SMSPool countries (synced)' })
  @ApiOkResponse()
  async countries() {
    const rows = await this.catalog.listCountries();
    return rows.map(toSmsCountryDto);
  }

  @Get('services')
  @ApiOperation({ summary: 'List SMS verification services (synced)' })
  @ApiOkResponse()
  async services(@Query() query: ListSmsServicesQueryDto) {
    const rows = await this.catalog.listServices(query);
    return rows.map(toSmsServiceDto);
  }

  @Get('offers')
  @ApiOperation({ summary: 'Browse published one-time SMS offers' })
  @ApiOkResponse()
  async offers(@Query() query: ListSmsOffersQueryDto) {
    const result = await this.catalog.listOneTimeOffers(query);
    return {
      data: result.data.map(toSmsOfferDto),
      meta: buildPaginationMeta(result.page, result.pageSize, result.total),
    };
  }

  @Get('rentals/catalog')
  @ApiOperation({ summary: 'Browse published number rental SKUs + plans' })
  @ApiOkResponse()
  async rentalCatalog(@Query() query: ListSmsRentalsQueryDto) {
    const result = await this.catalog.listRentalSkus(query);
    return {
      data: result.data.map(toSmsRentalSkuDto),
      meta: buildPaginationMeta(result.page, result.pageSize, result.total),
    };
  }

  @Post('verifications')
  @ApiOperation({ summary: 'Buy a one-time SMS verification number' })
  @ApiCreatedResponse()
  async createVerification(
    @CurrentUser() user: User,
    @Body() body: CreateSmsVerificationDto,
  ) {
    const order = await this.orders.createVerification(user, body.offerId);
    return toVerificationOrderDto(order);
  }

  @Get('verifications')
  @ApiOperation({ summary: 'List my SMS verification orders' })
  @ApiOkResponse()
  async listVerifications(@CurrentUser() user: User) {
    const rows = await this.orders.listVerifications(user.id);
    return rows.map(toVerificationOrderDto);
  }

  @Get('verifications/:orderId')
  @ApiOperation({ summary: 'Get one SMS verification order (includes code when ready)' })
  @ApiOkResponse()
  async getVerification(
    @CurrentUser() user: User,
    @Param('orderId') orderId: string,
  ) {
    const order = await this.orders.getVerification(user.id, orderId);
    return toVerificationOrderDto(order);
  }

  @Post('rentals')
  @ApiOperation({ summary: 'Rent a multi-day phone number' })
  @ApiCreatedResponse()
  async createRental(
    @CurrentUser() user: User,
    @Body() body: CreateNumberRentalDto,
  ) {
    const rental = await this.orders.createRental(user, body);
    return toRentalDto(rental);
  }

  @Get('rentals')
  @ApiOperation({ summary: 'List my number rentals' })
  @ApiOkResponse()
  async listRentals(@CurrentUser() user: User) {
    const rows = await this.orders.listRentals(user.id);
    return rows.map(toRentalDto);
  }

  @Get('rentals/:id')
  @ApiOperation({ summary: 'Get a rental + recent inbox messages' })
  @ApiOkResponse()
  async getRental(@CurrentUser() user: User, @Param('id') id: string) {
    const rental = await this.orders.getRentalForUser(user.id, id);
    return toRentalDto(rental);
  }

  @Post('rentals/:id/extend')
  @ApiOperation({ summary: 'Extend a rental by N days (wallet debit)' })
  @ApiOkResponse()
  async extend(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: ExtendNumberRentalDto,
  ) {
    const rental = await this.orders.extendRental(user, id, body.days);
    return toRentalDto(rental);
  }

  @Post('rentals/:id/refund')
  @ApiOperation({
    summary: 'Request a rental refund when SMSPool allows it',
  })
  @ApiOkResponse()
  async refund(@CurrentUser() user: User, @Param('id') id: string) {
    const rental = await this.orders.requestCustomerRefund(user.id, id);
    return toRentalDto(rental);
  }
}
