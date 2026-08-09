import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PricingProfileName, ProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
} from 'class-validator';

export class UpdateProductStatusDto {
  @ApiProperty({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  status!: ProductStatus;
}

export class UpdateProductPricingDto {
  @ApiPropertyOptional({ enum: PricingProfileName })
  @IsOptional()
  @IsEnum(PricingProfileName)
  pricingProfileName?: PricingProfileName;

  @ApiPropertyOptional({
    description: 'Manual retail price override in US dollars (e.g. 2.49)',
    example: 2.49,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  retailPrice?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  manualOverride?: boolean;
}

export class UpdateTopUpEnabledDto {
  @ApiProperty({
    description:
      "Kill switch for top-ups on this product's eSIMs. Turn on only after publishing at least one tier.",
  })
  @IsBoolean()
  enabled!: boolean;
}

export class WalletAdjustDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({
    description: 'Signed amount in USD (positive credit, negative debit)',
  })
  @Type(() => Number)
  @IsNumber()
  amount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RegisterEsimWebhookDto {
  @ApiProperty({
    example: 'https://abcd1234.ngrok-free.app/api/v1/webhooks/esim-access',
    description:
      'Public HTTPS webhook URL. Locally use ngrok pointing at this Nest API.',
  })
  @IsString()
  @IsUrl({ require_tld: false })
  webhookUrl!: string;
}

export class EsimWebhookConfigDto {
  @ApiProperty({ nullable: true })
  webhook!: string | null;
}

export class SyncResultDto {
  @ApiProperty({ description: 'Packages returned by supplier' })
  synced!: number;

  @ApiProperty({ description: 'New DRAFT products created' })
  created!: number;

  @ApiProperty({ description: 'Existing products updated' })
  updated!: number;

  @ApiProperty({ description: 'Regions/countries returned by supplier' })
  regionsSynced!: number;

  @ApiProperty({ description: 'New region rows created' })
  regionsCreated!: number;

  @ApiProperty({ description: 'Existing region rows updated' })
  regionsUpdated!: number;
}
