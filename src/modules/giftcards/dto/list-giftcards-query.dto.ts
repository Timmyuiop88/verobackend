import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';

const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value;

export class ListGiftCardsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'amazon',
    description: 'Free-text search across product and brand name',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    example: 'US',
    description:
      'ISO country code from GET /giftcards/countries. Global cards are always included.',
  })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({
    example: 'gaming',
    description: 'Category slug from GET /giftcards/categories',
  })
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @ApiPropertyOptional({
    example: 'amazon-1',
    description: 'Brand slug from GET /giftcards/brands',
  })
  @IsOptional()
  @IsString()
  brandSlug?: string;

  @ApiPropertyOptional({ description: 'Only cards redeemable worldwide' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  global?: boolean;
}

export class ListAdminGiftCardsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: ProductStatus,
    description: 'Filter the review queue — `DRAFT` is what awaits approval',
  })
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  @ApiPropertyOptional({ example: 'amazon' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ example: 'US' })
  @IsOptional()
  @IsString()
  countryCode?: string;

  @ApiPropertyOptional({ example: 'gaming' })
  @IsOptional()
  @IsString()
  categorySlug?: string;

  @ApiPropertyOptional({
    description:
      'Only products with at least one profitable denomination — the shortlist worth publishing',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  viableOnly?: boolean;
}

export class SearchQueryDto {
  @ApiPropertyOptional({ example: 'united' })
  @IsOptional()
  @IsString()
  q?: string;
}

export class QuoteGiftCardQueryDto {
  @ApiProperty({
    example: 25,
    description:
      "Face value in the product's recipient currency. Whole units only, within the product's min/max.",
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount!: number;
}
