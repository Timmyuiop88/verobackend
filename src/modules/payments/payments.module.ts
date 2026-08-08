import { Module } from '@nestjs/common';
import { ClerkModule } from '../integrations/clerk/clerk.module';
import { OxapayModule } from '../integrations/oxapay/oxapay.module';
import { PaystackModule } from '../integrations/paystack/paystack.module';
import { UsersModule } from '../users/users.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [ClerkModule, UsersModule, PaystackModule, OxapayModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
