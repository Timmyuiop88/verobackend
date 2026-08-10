import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { SmsPoolService } from './smspool.service';

@Module({
  imports: [HttpModule],
  providers: [SmsPoolService],
  exports: [SmsPoolService],
})
export class SmsPoolModule {}
