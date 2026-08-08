import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EsimInstallDetailsResponseDto {
  @ApiProperty({ format: 'uuid' })
  orderId!: string;

  @ApiProperty({
    description: 'Provider eSIM status (e.g. GOT_RESOURCE, IN_USE, USED_UP)',
  })
  status!: string;

  @ApiProperty()
  iccid!: string;

  @ApiProperty({
    description:
      'Full LPA activation string, e.g. "LPA:1$smdp.example.com$CODE"',
  })
  activationCode!: string;

  @ApiPropertyOptional({
    description:
      'SM-DP+ address parsed from the activation code, for manual-entry forms',
  })
  smdpAddress?: string | null;

  @ApiPropertyOptional({
    description:
      'Matching ID / confirmation code parsed from the activation code, for manual-entry forms',
  })
  matchingId?: string | null;

  @ApiProperty({
    description:
      'Scannable QR code image — show this as the primary install method',
  })
  qrCodeUrl!: string;

  @ApiPropertyOptional({
    description:
      'Shareable link to the QR image (e.g. to send via email/SMS instead of scanning)',
  })
  shortUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'One-tap install link for iOS 17.4+ (opens Settings directly, no camera needed). Only show this button on iOS Safari.',
  })
  iosInstallUrl?: string | null;

  @ApiPropertyOptional({
    description:
      'Manual APN — only needed if data does not connect automatically after install',
  })
  apn?: string | null;

  @ApiPropertyOptional()
  pin?: string | null;

  @ApiPropertyOptional()
  puk?: string | null;

  @ApiPropertyOptional({
    description: 'When the eSIM was installed/activated on a device, if known',
  })
  activatedAt?: Date | null;

  @ApiPropertyOptional({ description: 'Validity/expiry of the eSIM plan' })
  expiresAt?: Date | null;
}
