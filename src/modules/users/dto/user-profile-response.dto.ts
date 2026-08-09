import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UserProfileResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'Ada Lovelace' })
  displayName?: string | null;

  @ApiPropertyOptional({ example: '+2348012345678' })
  phone?: string | null;

  @ApiPropertyOptional({ example: 'NG', description: 'ISO country code' })
  country?: string | null;

  @ApiPropertyOptional({ description: 'URL to profile picture' })
  avatarUrl?: string | null;

  @ApiPropertyOptional()
  dateOfBirth?: Date | null;

  @ApiPropertyOptional({
    description:
      'Structured, known-shape settings (notifications, language, currency display, etc.)',
    example: { language: 'en', notifyByEmail: true },
  })
  preferences?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    description:
      "Open-ended bucket for any future custom fields that don't warrant a schema migration yet.",
    example: { referralSource: 'twitter' },
  })
  metadata?: Record<string, unknown> | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
