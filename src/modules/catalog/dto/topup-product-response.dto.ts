import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';

export class TopUpProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ description: 'Provider TOPUP_-prefixed package code' })
  packageCode!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ description: 'Data volume in bytes' })
  dataVolumeBytes?: string | null;

  @ApiPropertyOptional({ description: 'Human-readable data volume, e.g. 5 GB' })
  dataVolumeDisplay?: string | null;

  @ApiPropertyOptional()
  durationDays?: number | null;

  @ApiProperty({
    example: '1.38',
    description: 'Wholesale cost in USD (decimal string, 2 places)',
  })
  costPrice!: string;

  @ApiProperty({ example: '$1.38' })
  costPriceUsd!: string;

  @ApiProperty({
    example: '1.80',
    description: 'Retail price in USD (decimal string, 2 places)',
  })
  retailPrice!: string;

  @ApiProperty({ example: '$1.80' })
  retailPriceUsd!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({
    enum: ProductStatus,
    description: 'Must be PUBLISHED to appear in GET /esims/:id/topup-packages',
  })
  status!: ProductStatus;

  @ApiProperty({
    description:
      'When true, retail price was set manually and is not overwritten on re-sync',
  })
  manualOverride!: boolean;
}

export class TopUpSyncResultDto {
  @ApiProperty({
    description:
      "Top-up tiers returned by supplier for this product's packageCode",
  })
  synced!: number;

  @ApiProperty({ description: 'New DRAFT top-up tiers created' })
  created!: number;

  @ApiProperty({ description: 'Existing top-up tiers updated' })
  updated!: number;
}
