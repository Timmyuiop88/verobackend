import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

export class ListPublishedProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'US',
    description: 'Exact provider location code filter',
  })
  @IsOptional()
  @IsString()
  locationCode?: string;

  @ApiPropertyOptional({
    example: 'Japan',
    description:
      'Search by country/region name or code. Resolves via regions table (e.g. "Japan", "United States", "US", "Europe").',
  })
  @IsOptional()
  @IsString()
  country?: string;
}

export class ListAdminProductsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ProductStatus })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({
    example: 'US',
    description: 'Exact provider location code filter',
  })
  @IsOptional()
  @IsString()
  locationCode?: string;

  @ApiPropertyOptional({
    example: 'Japan',
    description:
      'Search by country/region name or code. Resolves via regions table.',
  })
  @IsOptional()
  @IsString()
  country?: string;
}
