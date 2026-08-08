import { Injectable } from '@nestjs/common';
import type { User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { ClerkAuthPayload } from '../integrations/clerk/clerk.service';

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
}
