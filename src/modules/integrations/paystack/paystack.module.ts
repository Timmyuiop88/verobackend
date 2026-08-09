import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PaystackService } from './paystack.service';

@Module({
  imports: [HttpModule],
  providers: [PaystackService],
  exports: [PaystackService],
})
export class PaystackModule {}
