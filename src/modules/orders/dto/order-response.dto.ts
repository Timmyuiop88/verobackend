import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, OrderType } from '@prisma/client';

export class OrderEsimDto {
  @ApiPropertyOptional()
  iccid?: string | null;

  @ApiPropertyOptional()
  lpaCode?: string | null;

  @ApiPropertyOptional()
  qrCodeUrl?: string | null;

  @ApiPropertyOptional()
  status?: string | null;
}

export class OrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: OrderType,
    description:
      'PURCHASE creates a new eSIM; TOPUP adds data/validity to an existing one (see targetEsimId).',
  })
  orderType!: OrderType;

  @ApiPropertyOptional({ format: 'uuid', description: 'Null for TOPUP orders' })
  productId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Set for TOPUP orders — the ProviderOrder (eSIM) id this top-up was applied to. Use with GET /esims/:id.',
  })
  targetEsimId?: string | null;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiPropertyOptional({
    description:
      'Set when status is FAILED/REFUNDED, e.g. "provider_rejected:200007:Insufficient account balance"',
  })
  failureReason?: string | null;

  @ApiPropertyOptional({
    type: OrderEsimDto,
    description: 'Only present for PURCHASE orders',
  })
  esim?: OrderEsimDto | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

export class OrderUsageResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty()
  dataUsedBytes!: string;

  @ApiPropertyOptional()
  dataTotalBytes?: string | null;

  @ApiPropertyOptional({
    description:
      "dataTotalBytes - dataUsedBytes, i.e. the user's remaining data balance",
  })
  dataRemainingBytes?: string | null;

  @ApiPropertyOptional({
    description: 'Percentage of the data package used so far, 0-100',
  })
  dataUsedPercent?: number | null;

  @ApiPropertyOptional()
  expiresAt?: Date | null;

  @ApiProperty()
  lastSyncedAt!: Date;

  @ApiProperty({
    type: Boolean,
    description:
      'Always false today. The eSIM Access provider only updates usage on their end every 2-3 hours — this is not a real-time meter regardless of how often you poll it.',
  })
  isProviderDataRealtime!: boolean;
}
