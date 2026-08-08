import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TopUpPackageResponseDto {
  @ApiProperty({ description: 'Pass this back in POST /esims/:id/topup' })
  packageCode!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  dataVolumeBytes?: string | null;

  @ApiPropertyOptional({ example: '5 GB' })
  dataVolumeDisplay?: string | null;

  @ApiPropertyOptional()
  durationDays?: number | null;

  @ApiProperty({ description: 'Plain decimal string, e.g. "9.99"' })
  retailPrice!: string;

  @ApiProperty({ description: 'Formatted for display, e.g. "$9.99"' })
  retailPriceUsd!: string;

  @ApiProperty()
  currency!: string;
}
