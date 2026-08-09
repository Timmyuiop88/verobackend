import { Module } from '@nestjs/common';
import { ClerkModule } from '../integrations/clerk/clerk.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [ClerkModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
