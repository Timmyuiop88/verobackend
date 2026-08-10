import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ReloadlyService } from './reloadly.service';

@Module({
  imports: [HttpModule],
  providers: [ReloadlyService],
  exports: [ReloadlyService],
})
export class ReloadlyModule {}
