import { ApiProperty } from '@nestjs/swagger';
import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

export class WalletTransactionDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: WalletTransactionType })
  type!: WalletTransactionType;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  balanceAfter!: string;

  @ApiProperty()
  reference!: string;

  @ApiProperty({ enum: WalletTransactionStatus })
  status!: WalletTransactionStatus;

  @ApiProperty()
  createdAt!: Date;
}

export class WalletResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  balance!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ type: [WalletTransactionDto] })
  transactions!: WalletTransactionDto[];
}
