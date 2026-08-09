import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../../common/dto/pagination.dto';

export class ProductResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  locationCode?: string | null;

  @ApiPropertyOptional({ description: 'Data volume in bytes' })
  dataVolumeBytes?: string | null;

  @ApiPropertyOptional({ description: 'Human-readable data volume, e.g. 5 GB' })
  dataVolumeDisplay?: string | null;

  @ApiPropertyOptional()
  durationDays?: number | null;

  @ApiProperty({
    example: '1.80',
    description: 'Retail price in USD (decimal string, 2 places)',
  })
  retailPrice!: string;

  @ApiProperty({
    example: '$1.80',
    description: 'Retail price formatted for display in US dollars',
  })
  retailPriceUsd!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;
}

export class AdminProductResponseDto extends ProductResponseDto {
  @ApiProperty({ description: 'Supplier package code (eSIM Access SKU)' })
  supplierSku!: string;

  @ApiProperty({
    example: '1.38',
    description: 'Wholesale cost in USD (decimal string, 2 places)',
  })
  costPrice!: string;

  @ApiProperty({
    example: '$1.38',
    description: 'Wholesale cost formatted for display in US dollars',
  })
  costPriceUsd!: string;

  @ApiProperty({
    description:
      'When true, retail price was set manually and is not overwritten on sync',
  })
  manualOverride!: boolean;

  @ApiProperty({
    description:
      "Kill switch for top-ups on eSIMs sold under this product. Off by default — flip on once you've reviewed/published tiers via GET /admin/products/:id/topup-packages.",
  })
  topUpEnabled!: boolean;
}

export class PaginatedProductsResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  data!: ProductResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class PaginatedAdminProductsResponseDto {
  @ApiProperty({ type: [AdminProductResponseDto] })
  data!: AdminProductResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
