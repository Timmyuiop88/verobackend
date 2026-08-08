import { createClerkClient, verifyToken } from '@clerk/backend';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/env.schema';
import { UserRole } from '@prisma/client';

export type ClerkAuthPayload = {
  clerkId: string;
  email: string;
  role: UserRole;
};

@Injectable()
export class ClerkService {
  private readonly logger = new Logger(ClerkService.name);
  private readonly clerk;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.clerk = createClerkClient({
      secretKey: this.config.get('CLERK_SECRET_KEY', { infer: true }),
    });
  }

  async verifyBearerToken(token: string): Promise<ClerkAuthPayload> {
    try {
      const payload = await verifyToken(token, {
        secretKey: this.config.get('CLERK_SECRET_KEY', { infer: true }),
        authorizedParties: ['http://localhost:3001', 'http://localhost:3000'],
      });

      const clerkId = payload.sub;
      if (!clerkId) {
        throw new UnauthorizedException('Invalid token subject');
      }

      const user = await this.clerk.users.getUser(clerkId);
      const email =
        user.primaryEmailAddress?.emailAddress ??
        user.emailAddresses[0]?.emailAddress;

      if (!email) {
        throw new UnauthorizedException('Clerk user has no email');
      }

      const metadataRole = (
        user.publicMetadata as { role?: string } | undefined
      )?.role;
      const orgRole = (payload as { org_role?: string }).org_role;
      const isAdmin =
        metadataRole === 'admin' ||
        orgRole === 'org:admin' ||
        orgRole === 'admin';
      const role = isAdmin ? UserRole.ADMIN : UserRole.USER;

      return { clerkId, email, role };
    } catch (err) {
      if (err instanceof UnauthorizedException) {
        throw err;
      }

      const message =
        err instanceof Error ? err.message : 'Unknown Clerk auth error';
      this.logger.error(`Clerk token verification failed: ${message}`, err);

      throw new UnauthorizedException(message);
    }
  }
}
