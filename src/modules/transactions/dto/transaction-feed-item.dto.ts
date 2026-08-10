import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TransactionCategory {
  ESIM_PURCHASE = 'ESIM_PURCHASE',
  ESIM_TOPUP = 'ESIM_TOPUP',
  GIFT_CARD_PURCHASE = 'GIFT_CARD_PURCHASE',
  WALLET_DEPOSIT = 'WALLET_DEPOSIT',
  WALLET_REFUND = 'WALLET_REFUND',
  WALLET_ADJUSTMENT = 'WALLET_ADJUSTMENT',
}

export enum TransactionDirection {
  CREDIT = 'credit',
  DEBIT = 'debit',
}

export enum TransactionFeedStatus {
  COMPLETED = 'COMPLETED',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
}

export class TransactionFeedItemDto {
  @ApiProperty({
    description:
      'Composite id — not a single DB row (an order or a wallet transaction)',
    example: 'order:3f7b1e2a-...',
  })
  id!: string;

  @ApiProperty({ enum: TransactionCategory })
  category!: TransactionCategory;

  @ApiProperty({ enum: TransactionDirection })
  direction!: TransactionDirection;

  @ApiProperty({ example: 'eSIM — Turkey 1GB / 7 Days' })
  title!: string;

  @ApiPropertyOptional({ example: '1GB · 7 Days', nullable: true })
  subtitle!: string | null;

  @ApiProperty({ example: '4.99', description: 'Unsigned decimal string' })
  amount!: string;

  @ApiProperty({
    example: '-$4.99',
    description: 'Signed, currency-formatted for direct display',
  })
  amountDisplay!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({
    enum: TransactionFeedStatus,
    description:
      'Normalized 3-state status for filter tabs (All/Completed/Pending/Failed)',
  })
  status!: TransactionFeedStatus;

  @ApiProperty({
    example: 'REFUNDED',
    description:
      'Original underlying OrderStatus/WalletTransactionStatus value',
  })
  rawStatus!: string;

  @ApiPropertyOptional({ nullable: true })
  reference!: string | null;

  @ApiProperty({ format: 'date-time' })
  date!: Date;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'IDs to deep-link into the underlying resource (orderId, walletTransactionId, targetEsimId, etc.)',
  })
  meta!: Record<string, unknown>;
}
