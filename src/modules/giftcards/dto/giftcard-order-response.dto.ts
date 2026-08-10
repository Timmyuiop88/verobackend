import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GiftCardIssuanceStatus, OrderStatus } from '@prisma/client';

export class GiftCardOrderResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: OrderStatus })
  status!: OrderStatus;

  @ApiProperty({ example: '49.50' })
  amount!: string;

  @ApiProperty({ example: '$49.50' })
  amountDisplay!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiPropertyOptional({ nullable: true, example: 'Amazon US' })
  productName!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '50.00' })
  faceValue!: string | null;

  @ApiPropertyOptional({ nullable: true })
  brandLogoUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  redeemInstructions!: string | null;

  @ApiPropertyOptional({ enum: GiftCardIssuanceStatus, nullable: true })
  providerStatus!: GiftCardIssuanceStatus | null;

  @ApiProperty({
    description:
      'Whether a code exists to reveal. Codes themselves are only returned by POST /giftcards/orders/:id/reveal.',
  })
  codeAvailable!: boolean;

  @ApiPropertyOptional({ nullable: true, format: 'date-time' })
  revealedAt!: Date | null;

  @ApiPropertyOptional({ nullable: true })
  failureReason!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class GiftCardCodeDto {
  @ApiPropertyOptional({ nullable: true, example: '1234-5678-9012-3456' })
  cardNumber!: string | null;

  @ApiPropertyOptional({ nullable: true, example: '4821' })
  pinCode!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Embeds the redemption code — treat with the same care as the card number',
  })
  redemptionUrl!: string | null;
}

export class GiftCardRevealResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({ example: 'Amazon US' })
  productName!: string;

  @ApiProperty({ example: '50.00' })
  faceValue!: string;

  @ApiPropertyOptional({ nullable: true })
  redeemInstructions!: string | null;

  @ApiProperty({ type: [GiftCardCodeDto] })
  cards!: GiftCardCodeDto[];
}
