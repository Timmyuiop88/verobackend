import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductStatus, SmsPricingScope } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateSmsStatusDto {
  @ApiProperty({ enum: ProductStatus })
  @IsEnum(ProductStatus)
  status!: ProductStatus;
}

export class UpdateSmsPriceDto {
  @ApiProperty({ example: '1.50' })
  @IsString()
  retailPrice!: string;
}

export class UpsertSmsPricingRuleDto {
  @ApiProperty({ enum: SmsPricingScope })
  @IsEnum(SmsPricingScope)
  scope!: SmsPricingScope;

  @ApiProperty({ example: '*' })
  @IsString()
  scopeRef!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  markupPercent!: number;

  @ApiPropertyOptional({ example: 0.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  floorAmount?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
