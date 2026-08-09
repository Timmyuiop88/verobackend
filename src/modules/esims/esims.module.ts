import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { TOPUP_ORDER_QUEUE } from '../fulfillment/fulfillment.constants';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { WalletModule } from '../wallet/wallet.module';
import { EsimsController } from './esims.controller';
import { EsimsService } from './esims.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: TOPUP_ORDER_QUEUE }),
    EsimAccessModule,
    CatalogModule,
    WalletModule,
  ],
  controllers: [EsimsController],
  providers: [EsimsService],
})
export class EsimsModule {}
