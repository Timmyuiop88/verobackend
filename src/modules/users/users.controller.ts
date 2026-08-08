import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { UserResponseDto } from './dto/user-response.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('users')
export class UsersController {
  @Get('me')
  @ApiOperation({
    summary: 'Get current user (also syncs Clerk → DB)',
    description: [
      'Returns the authenticated TradeVero user.',
      '',
      '**Frontend flow after Clerk signup/login:**',
      '1. Complete Clerk sign-up or sign-in on the client.',
      '2. Read the Clerk session JWT.',
      '3. Call this endpoint with `Authorization: Bearer <token>`.',
      '4. On first success, the backend creates the local `user` and a `wallet` with balance `0`.',
      '5. Subsequent calls refresh `email` / `role` from Clerk and return the same user.',
      '',
      'There is no separate signup API — this endpoint (or any other protected route) performs the DB sync via upsert on `clerkId`.',
      '',
      'Prefer calling this once right after login before using wallet, payments, or orders.',
    ].join('\n'),
  })
  @ApiOkResponse({
    type: UserResponseDto,
    description:
      'Local user record. Created on first authenticated request; updated on later ones.',
  })
  @ApiUnauthorizedResponse({
    description:
      'Missing/invalid Clerk Bearer JWT, or Clerk user has no email.',
  })
  me(@CurrentUser() user: User): UserResponseDto {
    return user;
  }
}
