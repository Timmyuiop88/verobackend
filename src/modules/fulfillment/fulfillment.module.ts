import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { WalletModule } from '../wallet/wallet.module';
import {
  FULFILL_ORDER_QUEUE,
  POLL_ESIM_ORDER_QUEUE,
  TOPUP_ORDER_QUEUE,
} from './fulfillment.constants';
import { FulfillmentProcessor } from './fulfillment.processor';
import { FulfillmentService } from './fulfillment.service';
import { PollEsimOrderProcessor } from './poll-esim-order.processor';
import { ReconciliationService } from './reconciliation.service';
import { TopUpProcessor } from './topup.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: FULFILL_ORDER_QUEUE },
      { name: POLL_ESIM_ORDER_QUEUE },
      { name: TOPUP_ORDER_QUEUE },
    ),
    EsimAccessModule,
    WalletModule,
  ],
  providers: [
    FulfillmentProcessor,
    PollEsimOrderProcessor,
    TopUpProcessor,
    FulfillmentService,
    ReconciliationService,
  ],
  exports: [FulfillmentService],
})
export class FulfillmentModule {}
