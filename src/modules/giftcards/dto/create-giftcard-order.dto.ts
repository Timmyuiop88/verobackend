import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateGiftCardOrderDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'Denomination id from GET /giftcards/:idOrSlug — the specific face value being bought, not the product id',
  })
  @IsUUID()
  denominationId!: string;

  @ApiPropertyOptional({
    description:
      "Optional recipient for the provider's own delivery email. The code is always available in-app regardless.",
    example: 'friend@example.com',
  })
  @IsOptional()
  @IsEmail()
  recipientEmail?: string;

  @ApiPropertyOptional({
    description:
      'Required when the product has `userIdRequired` — the game/account id the top-up is applied to.',
    example: '123456789',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalUserId?: string;
}
