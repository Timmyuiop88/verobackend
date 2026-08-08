import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { EsimAccessService } from './esim-access.service';

@Module({
  imports: [HttpModule],
  providers: [EsimAccessService],
  exports: [EsimAccessService],
})
export class EsimAccessModule {}
