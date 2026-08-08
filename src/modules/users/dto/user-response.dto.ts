import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'TradeVero internal user id (use this in app flows).',
  })
  id!: string;

  @ApiProperty({
    description: 'Clerk user id (`sub`). Unique key used for upsert sync.',
  })
  clerkId!: string;

  @ApiProperty({
    description:
      'Primary email from Clerk; refreshed on each authenticated request.',
  })
  email!: string;

  @ApiProperty({
    enum: UserRole,
    description:
      'Denormalized role cache from Clerk (`publicMetadata.role=admin` or org admin → ADMIN). Clerk remains source of truth for authorization.',
  })
  role!: UserRole;

  @ApiProperty({
    description:
      'When the local user row was first created (first successful auth sync).',
  })
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}
