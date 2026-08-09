import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
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
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { UserProfileResponseDto } from './dto/user-profile-response.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { toUserProfileResponse } from './users.mapper';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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
      '4. On first success, the backend creates the local `user`, a `wallet` with balance `0`, and an empty `profile`.',
      '5. Subsequent calls refresh `email` / `role` from Clerk and return the same user.',
      '',
      'There is no separate signup API — this endpoint (or any other protected route) performs the DB sync via upsert on `clerkId`.',
      '',
      'Prefer calling this once right after login before using wallet, payments, or orders.',
      '',
      'Custom profile fields (display name, phone, avatar, preferences, etc.) live separately —',
      'see `GET/PATCH /users/me/profile`. This endpoint only returns Clerk-sourced identity fields.',
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

  @Get('me/profile')
  @ApiOperation({
    summary: "Get current user's custom profile",
    description: [
      'Custom, TradeVero-owned profile data (display name, phone, country, avatar, preferences,',
      'and a free-form `metadata` bucket for anything else) — deliberately kept out of Clerk so',
      'it stays queryable and portable if the auth provider ever changes. Clerk continues to own',
      'identity only (email, login) — see `GET /users/me`.',
      '',
      "Auto-created empty on first call if it somehow doesn't exist yet (e.g. users created before this feature shipped).",
    ].join('\n'),
  })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async getProfile(@CurrentUser() user: User): Promise<UserProfileResponseDto> {
    const profile = await this.usersService.getOrCreateProfile(user.id);
    return toUserProfileResponse(profile);
  }

  @Patch('me/profile')
  @ApiOperation({
    summary: "Update current user's custom profile",
    description:
      "Partial update — omit fields you don't want to change. `preferences` and `metadata` are each replaced wholesale when provided (not deep-merged), so send the full object for those keys.",
  })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async updateProfile(
    @CurrentUser() user: User,
    @Body() dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponseDto> {
    const profile = await this.usersService.updateProfile(user.id, dto);
    return toUserProfileResponse(profile);
  }
}
