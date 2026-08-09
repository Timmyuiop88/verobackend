import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { UserRole, type User } from '@prisma/client';
import { ClerkService } from '../../modules/integrations/clerk/clerk.service';
import { UsersService } from '../../modules/users/users.service';

/**
 * Admin authorization uses Clerk JWT claims as source of truth.
 * Local users.role is refreshed as a denormalized cache only.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly clerkService: ClerkService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User }>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new ForbiddenException('Admin access required');
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = await this.clerkService.verifyBearerToken(token);

    if (payload.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin access required');
    }

    const user = await this.usersService.upsertFromClerk(payload);
    request.user = user;
    return true;
  }
}
