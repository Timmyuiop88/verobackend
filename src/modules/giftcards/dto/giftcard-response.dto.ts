import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GiftCardDenominationType, ProductStatus } from '@prisma/client';
import { PaginationMetaDto } from '../../../common/dto/pagination.dto';

export class GiftCardDenominationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Pass this to POST /giftcards/orders',
  })
  id!: string;

  @ApiProperty({ example: '50.00', description: 'Face value of the card' })
  faceValue!: string;

  @ApiProperty({ example: '$50.00' })
  faceValueDisplay!: string;

  @ApiProperty({ example: '49.50', description: 'What the customer pays' })
  price!: string;

  @ApiProperty({ example: '$49.50' })
  priceDisplay!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiPropertyOptional({
    example: '1.00',
    nullable: true,
    description:
      'Saving versus face value, when the card is sold below face. Null when priced at or above face.',
  })
  savings!: string | null;
}

export class AdminGiftCardDenominationDto extends GiftCardDenominationDto {
  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiProperty({
    example: '50.00',
    description: 'Reloadly charge before fee/discount',
  })
  senderCost!: string;

  @ApiProperty({ example: '0.50' })
  feeAmount!: string;

  @ApiProperty({
    example: '3.75',
    description: 'Reloadly commission on this denomination',
  })
  discountAmount!: string;

  @ApiProperty({
    example: '46.75',
    description: 'senderCost + fee - discount. Retail must beat this.',
  })
  netCost!: string;

  @ApiProperty({ example: '2.75', description: 'price - netCost' })
  margin!: string;

  @ApiProperty({
    example: '5.88',
    description: 'Margin as a percentage of net cost',
  })
  marginPercent!: string;

  @ApiProperty({
    description:
      'False when no price clears the margin floor within the over-face ceiling. Non-viable rows cannot be published without a manual price.',
  })
  viable!: boolean;

  @ApiPropertyOptional({
    nullable: true,
    example: 'price_exceeds_face_ceiling:retail=52.50,ceiling=51.50',
  })
  viabilityNote!: string | null;

  @ApiProperty({
    description: 'Retail price was set by hand and survives syncs',
  })
  manualOverride!: boolean;
}

export class GiftCardBrandDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Amazon' })
  name!: string;

  @ApiProperty({ example: 'amazon-1' })
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  logoUrl!: string | null;
}

export class GiftCardCategoryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Gaming' })
  name!: string;

  @ApiProperty({ example: 'gaming' })
  slug!: string;

  @ApiPropertyOptional({ nullable: true })
  iconUrl!: string | null;

  @ApiProperty()
  featured!: boolean;
}

export class GiftCardCountryDto {
  @ApiProperty({ example: 'US' })
  code!: string;

  @ApiProperty({ example: 'United States' })
  name!: string;

  @ApiPropertyOptional({ nullable: true, example: 'North America' })
  continent!: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'USD' })
  currencyCode!: string | null;

  @ApiPropertyOptional({ nullable: true })
  flagUrl!: string | null;
}

export class GiftCardProductDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'amazon-us-1' })
  slug!: string;

  @ApiProperty({ example: 'Amazon US' })
  name!: string;

  @ApiPropertyOptional({ type: GiftCardBrandDto, nullable: true })
  brand!: GiftCardBrandDto | null;

  @ApiPropertyOptional({ type: GiftCardCategoryDto, nullable: true })
  category!: GiftCardCategoryDto | null;

  @ApiPropertyOptional({ nullable: true, example: 'US' })
  countryCode!: string | null;

  @ApiProperty({ description: 'Redeemable in any country' })
  global!: boolean;

  @ApiProperty({ enum: GiftCardDenominationType })
  denominationType!: GiftCardDenominationType;

  @ApiProperty({
    example: 'USD',
    description: 'Currency the card is denominated in',
  })
  recipientCurrencyCode!: string;

  @ApiPropertyOptional({ nullable: true })
  logoUrl!: string | null;

  @ApiProperty({
    description:
      'Requires a game/account user ID at checkout — send `externalUserId` when ordering.',
  })
  userIdRequired!: boolean;

  @ApiPropertyOptional({ nullable: true })
  redeemInstructionConcise!: string | null;

  @ApiPropertyOptional({ nullable: true })
  redeemInstructionVerbose!: string | null;

  @ApiProperty({ type: [GiftCardDenominationDto] })
  denominations!: GiftCardDenominationDto[];
}

export class AdminGiftCardProductDto extends GiftCardProductDto {
  @ApiProperty({ example: 19382, description: 'Reloadly productId' })
  externalProductId!: number;

  @ApiProperty({ enum: ProductStatus })
  status!: ProductStatus;

  @ApiPropertyOptional({ nullable: true, example: 'ACTIVE' })
  providerStatus!: string | null;

  @ApiProperty({
    example: '7.5',
    description: "Reloadly's commission percentage",
  })
  discountPercentage!: string;

  @ApiProperty({ example: '1.0' })
  senderFeePercentage!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  pricingRuleId!: string | null;

  @ApiProperty({ format: 'date-time' })
  lastSeenAt!: Date;

  @ApiProperty({ type: [AdminGiftCardDenominationDto] })
  declare denominations: AdminGiftCardDenominationDto[];
}

export class PaginatedGiftCardsResponseDto {
  @ApiProperty({ type: [GiftCardProductDto] })
  data!: GiftCardProductDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}

export class PaginatedAdminGiftCardsResponseDto {
  @ApiProperty({ type: [AdminGiftCardProductDto] })
  data!: AdminGiftCardProductDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta!: PaginationMetaDto;
}
