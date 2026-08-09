import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsUrl, Min } from 'class-validator';

export class InitializePaymentDto {
  @ApiProperty({ example: 10, description: 'Deposit amount in USD' })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({ description: 'Return URL after payment' })
  @IsOptional()
  @IsUrl({ require_tld: false })
  returnUrl?: string;
}

export class PaymentInitializeResponseDto {
  @ApiProperty()
  paymentIntentId!: string;

  @ApiProperty()
  provider!: string;

  @ApiProperty()
  reference!: string;

  @ApiProperty()
  paymentUrl!: string;

  @ApiProperty()
  amount!: string;

  @ApiProperty()
  currency!: string;
}
