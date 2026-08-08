import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { OxapayService } from './oxapay.service';

@Module({
  imports: [HttpModule],
  providers: [OxapayService],
  exports: [OxapayService],
})
export class OxapayModule {}
