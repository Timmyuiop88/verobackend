import { Global, Module } from '@nestjs/common';
import { AdminGuard } from '../../common/guards/admin.guard';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { ClerkModule } from '../integrations/clerk/clerk.module';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [ClerkModule, UsersModule],
  providers: [ClerkAuthGuard, AdminGuard],
  exports: [ClerkModule, UsersModule, ClerkAuthGuard, AdminGuard],
})
export class AuthModule {}
