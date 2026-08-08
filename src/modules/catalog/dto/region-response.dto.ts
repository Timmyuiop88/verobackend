import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SubLocationDto {
  @ApiProperty({ example: 'ES' })
  code!: string;

  @ApiProperty({ example: 'Spain' })
  name!: string;
}

export class RegionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'US', description: 'Provider location code' })
  code!: string;

  @ApiProperty({ example: 'United States' })
  name!: string;

  @ApiProperty({
    example: 1,
    description: '1 = country, 2 = multi-country region',
  })
  type!: number;

  @ApiProperty({ enum: ['COUNTRY', 'REGION'] })
  typeLabel!: 'COUNTRY' | 'REGION';

  @ApiProperty({ type: [SubLocationDto] })
  subLocations!: SubLocationDto[];
}

export class ListRegionsQueryDto {
  @ApiPropertyOptional({
    description:
      'Search by country/region name or code (e.g. Japan, US, Europe)',
    example: 'Japan',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    description: '1 = countries only, 2 = multi-country regions only',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2)
  type?: number;
}
