import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EsimAssetResponseDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Use this id for /esims/:id, /esims/:id/topup, /esims/:id/topups',
  })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The original PURCHASE order that created this eSIM',
  })
  purchaseOrderId!: string;

  @ApiPropertyOptional()
  iccid?: string | null;

  @ApiPropertyOptional({
    description: 'Provider eSIM status (e.g. GOT_RESOURCE, IN_USE, USED_UP)',
  })
  status?: string | null;

  @ApiPropertyOptional({
    description:
      'Plan name from the original purchase, e.g. "Europe 5GB 30 Days"',
  })
  productName?: string | null;

  @ApiPropertyOptional({
    description: 'eSIM Access location code, e.g. "US", "EU"',
  })
  locationCode?: string | null;

  @ApiProperty({
    description:
      'Soft hint only — always re-verify with GET /esims/:id/topup-packages before showing pricing, this may lag the live provider state.',
  })
  canTopUp!: boolean;

  @ApiPropertyOptional()
  dataUsedBytes?: string | null;

  @ApiPropertyOptional()
  dataTotalBytes?: string | null;

  @ApiPropertyOptional({ description: 'dataTotalBytes - dataUsedBytes' })
  dataRemainingBytes?: string | null;

  @ApiPropertyOptional({ description: '0-100' })
  dataUsedPercent?: number | null;

  @ApiPropertyOptional({ description: 'Validity/expiry of the current plan' })
  expiresAt?: Date | null;

  @ApiPropertyOptional()
  activatedAt?: Date | null;

  @ApiProperty()
  createdAt!: Date;
}
