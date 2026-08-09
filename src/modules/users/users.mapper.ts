import type { UserProfile } from '@prisma/client';
import type { UserProfileResponseDto } from './dto/user-profile-response.dto';

export function toUserProfileResponse(
  profile: UserProfile,
): UserProfileResponseDto {
  return {
    id: profile.id,
    displayName: profile.displayName,
    phone: profile.phone,
    country: profile.country,
    avatarUrl: profile.avatarUrl,
    dateOfBirth: profile.dateOfBirth,
    preferences: profile.preferences as Record<string, unknown> | null,
    metadata: profile.metadata as Record<string, unknown> | null,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}
