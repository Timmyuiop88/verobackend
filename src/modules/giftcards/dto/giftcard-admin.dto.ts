import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GiftCardPricingScope,
  GiftCardSyncStatus,
  ProductStatus,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateGiftCardStatusDto {
  @ApiProperty({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  status!: ProductStatus;

  @ApiPropertyOptional({
    default: true,
    description:
      "Also apply to the product's denominations. When publishing, only viable ones are included.",
  })
  @IsOptional()
  @IsBoolean()
  cascade?: boolean;
}

export class UpdateGiftCardPriceDto {
  @ApiProperty({
    example: 48.99,
    description: 'Manual retail price in USD. Preserved across catalog syncs.',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPrice!: number;
}

export class UpsertGiftCardPricingRuleDto {
  @ApiProperty({ enum: GiftCardPricingScope })
  @IsEnum(GiftCardPricingScope)
  scope!: GiftCardPricingScope;

  @ApiPropertyOptional({
    description:
      'Category/brand/product uuid, or ISO country code. Ignored (and forced to "*") for GLOBAL.',
    example: 'US',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  scopeRef?: string;

  @ApiProperty({ example: 'Gaming — tolerate above face' })
  @IsString()
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({
    example: 5,
    description:
      'Minimum profit over net cost, as a percentage. The price floor.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minMarginPercent?: number;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Discount off face value shown to the customer when margin allows.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  customerDiscountPercent?: number;

  @ApiPropertyOptional({
    example: 3,
    description:
      'How far above face value this scope may be priced before a denomination is marked non-viable.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  maxOverFacePercent?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class AssignPricingRuleDto {
  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: 'Null clears the override and falls back to the scope chain.',
  })
  @IsOptional()
  @IsUUID()
  pricingRuleId?: string | null;
}

export class GiftCardPricingRuleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: GiftCardPricingScope })
  scope!: GiftCardPricingScope;

  @ApiProperty({ example: '*' })
  scopeRef!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ example: '5.00' })
  minMarginPercent!: string;

  @ApiProperty({ example: '1.00' })
  customerDiscountPercent!: string;

  @ApiProperty({ example: '3.00' })
  maxOverFacePercent!: string;

  @ApiProperty()
  active!: boolean;
}

export class GiftCardSyncRunDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: GiftCardSyncStatus })
  status!: GiftCardSyncStatus;

  @ApiProperty({ example: 'admin' })
  trigger!: string;

  @ApiProperty({ format: 'date-time' })
  startedAt!: Date;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  finishedAt!: Date | null;

  @ApiProperty()
  countriesSynced!: number;

  @ApiProperty()
  categoriesSynced!: number;

  @ApiProperty()
  brandsSynced!: number;

  @ApiProperty()
  pagesFetched!: number;

  @ApiProperty()
  productsSynced!: number;

  @ApiProperty()
  productsCreated!: number;

  @ApiProperty()
  productsUpdated!: number;

  @ApiProperty()
  productsArchived!: number;

  @ApiProperty()
  denominationsSynced!: number;

  @ApiProperty()
  denominationsHidden!: number;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Set when the stale sweep declined to archive — page errors, or too large a share of the catalog',
  })
  sweepSkippedReason!: string | null;

  @ApiPropertyOptional({ nullable: true, type: [String] })
  errors!: string[] | null;
}

export class RepriceResultDto {
  @ApiProperty({ example: 41230 })
  repriced!: number;

  @ApiProperty({
    example: 12,
    description:
      'Published denominations pulled back to DRAFT because they stopped being profitable',
  })
  demoted!: number;
}

export class DiscountReconcileResultDto {
  @ApiProperty({ example: 13284, description: 'Discount entries examined' })
  checked!: number;

  @ApiProperty({ example: 37, description: 'Products whose commission moved' })
  changed!: number;

  @ApiProperty({ example: 142 })
  denominationsRepriced!: number;

  @ApiProperty({
    example: 4,
    description:
      'Published denominations pulled back to DRAFT because the new rate made them unprofitable',
  })
  demoted!: number;
}

export class GiftCardBalanceDto {
  @ApiProperty({ example: 1520.35 })
  balance!: number;

  @ApiProperty({ example: 'USD' })
  currencyCode!: string;

  @ApiProperty({
    description: 'Balance has dropped below RELOADLY_MIN_BALANCE_ALERT',
  })
  low!: boolean;
}

export class MarginReportQueryDto {
  @ApiPropertyOptional({ example: '2026-08-01' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2026-08-31' })
  @IsOptional()
  @IsDateString()
  to?: string;
}

export class MarginReportDto {
  @ApiProperty({ example: 142 })
  orders!: number;

  @ApiProperty({ example: '6842.50' })
  revenue!: string;

  @ApiProperty({ example: '6480.10' })
  cost!: string;

  @ApiProperty({ example: '362.40' })
  margin!: string;

  @ApiProperty({ example: '5.30' })
  marginPercent!: string;

  @ApiProperty({
    example: 0,
    description:
      'Sales that lost money — usually a provider price change between syncs. Investigate the pricing rule.',
  })
  negativeMarginOrders!: number;
}
