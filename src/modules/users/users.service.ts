import { Injectable } from '@nestjs/common';
import type { Prisma, User, UserProfile } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ClerkAuthPayload } from '../integrations/clerk/clerk.service';
import type { UpdateUserProfileDto } from './dto/update-user-profile.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertFromClerk(payload: ClerkAuthPayload): Promise<User> {
    return this.prisma.user.upsert({
      where: { clerkId: payload.clerkId },
      create: {
        clerkId: payload.clerkId,
        email: payload.email,
        role: payload.role,
        wallet: {
          create: {
            balance: 0,
            currency: 'USD',
          },
        },
        profile: {
          create: {},
        },
      },
      update: {
        email: payload.email,
        role: payload.role,
      },
    });
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Lazy-create-on-read safety net for users created before UserProfile
   * existed. New users always get one eagerly in `upsertFromClerk`, same as
   * their wallet.
   */
  async getOrCreateProfile(userId: string): Promise<UserProfile> {
    const existing = await this.prisma.userProfile.findUnique({
      where: { userId },
    });
    if (existing) {
      return existing;
    }
    return this.prisma.userProfile.create({ data: { userId } });
  }

  async updateProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfile> {
    await this.getOrCreateProfile(userId);

    const data: Prisma.UserProfileUpdateInput = {};
    if (dto.displayName !== undefined) data.displayName = dto.displayName;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.dateOfBirth !== undefined) {
      data.dateOfBirth = new Date(dto.dateOfBirth);
    }
    if (dto.preferences !== undefined) {
      data.preferences = dto.preferences as Prisma.InputJsonValue;
    }
    if (dto.metadata !== undefined) {
      data.metadata = dto.metadata as Prisma.InputJsonValue;
    }

    return this.prisma.userProfile.update({ where: { userId }, data });
  }
}
