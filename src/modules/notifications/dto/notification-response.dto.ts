import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

export class NotificationResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: NotificationType })
  type!: NotificationType;

  @ApiProperty({ example: 'Deposit successful' })
  title!: string;

  @ApiProperty({ example: 'Your wallet was credited $10.00.' })
  message!: string;

  @ApiPropertyOptional({
    description:
      'Structured context for deep-linking, e.g. { "orderId": "..." }. Shape depends on `type`.',
    type: 'object',
    additionalProperties: true,
    nullable: true,
  })
  data!: Record<string, unknown> | null;

  @ApiProperty({ example: false })
  read!: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  readAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}
