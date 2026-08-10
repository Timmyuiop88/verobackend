import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { buildPaginationMeta } from '../../common/dto/pagination.dto';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsPoolService } from '../integrations/smspool/smspool.service';
import {
  UpdateSmsPriceDto,
  UpdateSmsStatusDto,
  UpsertSmsPricingRuleDto,
} from './dto/sms-admin.dto';
import { ListSmsOffersQueryDto, ListSmsRentalsQueryDto } from './dto/sms.dto';
import { SmsCatalogService } from './sms-catalog.service';
import { SmsSyncScheduler } from './sms-sync.scheduler';
import {
  toSmsOfferDto,
  toSmsPricingRuleDto,
  toSmsRentalPlanDto,
  toSmsRentalSkuDto,
  toSmsSyncRunDto,
} from './sms.mapper';

@ApiTags('admin')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Admin role required' })
@UseGuards(ClerkAuthGuard, AdminGuard)
@Controller('admin/sms')
export class SmsAdminController {
  constructor(
    private readonly catalog: SmsCatalogService,
    private readonly scheduler: SmsSyncScheduler,
    private readonly smspool: SmsPoolService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('sync')
  @ApiOperation({ summary: 'Enqueue SMSPool catalog sync' })
  @ApiOkResponse()
  enqueueSync() {
    return this.scheduler.enqueueAdmin();
  }

  @Get('sync/runs')
  @ApiOperation({ summary: 'Recent SMSPool sync runs' })
  @ApiOkResponse()
  async syncRuns() {
    const runs = await this.prisma.smsSyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return runs.map(toSmsSyncRunDto);
  }

  @Get('balance')
  @ApiOperation({ summary: 'SMSPool prepaid balance' })
  @ApiOkResponse()
  async balance() {
    const balance = await this.smspool.getBalance();
    return { balance: String(balance.balance) };
  }

  @Get('offers')
  @ApiOperation({ summary: 'Admin list one-time offers (any status)' })
  @ApiOkResponse()
  async offers(@Query() query: ListSmsOffersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 24;
    const where = {
      ...(query.serviceId ? { serviceId: query.serviceId } : {}),
      ...(query.countryCode
        ? { country: { code: query.countryCode.toUpperCase() } }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.smsOneTimeOffer.findMany({
        where,
        include: { service: true, country: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.smsOneTimeOffer.count({ where }),
    ]);
    return {
      data: data.map(toSmsOfferDto),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  @Patch('offers/:id/status')
  @ApiOkResponse()
  async setOfferStatus(
    @Param('id') id: string,
    @Body() body: UpdateSmsStatusDto,
  ) {
    const offer = await this.catalog.setOfferStatus(id, body.status);
    return toSmsOfferDto(offer);
  }

  @Patch('offers/:id/price')
  @ApiOkResponse()
  async setOfferPrice(
    @Param('id') id: string,
    @Body() body: UpdateSmsPriceDto,
  ) {
    const offer = await this.catalog.setOfferRetailPrice(id, body.retailPrice);
    return {
      id: offer.id,
      retailPrice: offer.retailPrice.toString(),
      manualOverride: offer.manualOverride,
    };
  }

  @Get('rentals')
  @ApiOkResponse()
  async rentals(@Query() query: ListSmsRentalsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 24;
    const where = {
      ...(query.countryCode
        ? { countryCode: query.countryCode.toUpperCase() }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.smsRentalSku.findMany({
        where,
        include: { country: true, plans: { orderBy: { days: 'asc' } } },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.smsRentalSku.count({ where }),
    ]);
    return {
      data: data.map(toSmsRentalSkuDto),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  @Patch('rental-skus/:id/status')
  @ApiOkResponse()
  async setSkuStatus(
    @Param('id') id: string,
    @Body() body: UpdateSmsStatusDto,
  ) {
    const sku = await this.catalog.setRentalSkuStatus(id, body.status);
    return toSmsRentalSkuDto(sku);
  }

  @Patch('rental-plans/:id/status')
  @ApiOkResponse()
  async setPlanStatus(
    @Param('id') id: string,
    @Body() body: UpdateSmsStatusDto,
  ) {
    const plan = await this.catalog.setRentalPlanStatus(id, body.status);
    return toSmsRentalPlanDto(plan);
  }

  @Patch('rental-plans/:id/price')
  @ApiOkResponse()
  async setPlanPrice(
    @Param('id') id: string,
    @Body() body: UpdateSmsPriceDto,
  ) {
    const plan = await this.catalog.setPlanRetailPrice(id, body.retailPrice);
    return {
      id: plan.id,
      retailPrice: plan.retailPrice.toString(),
      manualOverride: plan.manualOverride,
    };
  }

  @Get('pricing-rules')
  @ApiOkResponse()
  async listRules() {
    const rules = await this.prisma.smsPricingRule.findMany({
      orderBy: { scope: 'asc' },
    });
    return rules.map(toSmsPricingRuleDto);
  }

  @Put('pricing-rules')
  @ApiOkResponse()
  async upsertRule(@Body() body: UpsertSmsPricingRuleDto) {
    const rule = await this.prisma.smsPricingRule.upsert({
      where: {
        scope_scopeRef: { scope: body.scope, scopeRef: body.scopeRef },
      },
      create: {
        scope: body.scope,
        scopeRef: body.scopeRef,
        name: body.name,
        markupPercent: new Prisma.Decimal(body.markupPercent),
        floorAmount:
          body.floorAmount !== undefined
            ? new Prisma.Decimal(body.floorAmount)
            : null,
        active: body.active ?? true,
      },
      update: {
        name: body.name,
        markupPercent: new Prisma.Decimal(body.markupPercent),
        floorAmount:
          body.floorAmount !== undefined
            ? new Prisma.Decimal(body.floorAmount)
            : undefined,
        active: body.active,
      },
    });
    return toSmsPricingRuleDto(rule);
  }
}
