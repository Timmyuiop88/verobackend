import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { SmsPoolModule } from '../integrations/smspool/smspool.module';
import { WalletModule } from '../wallet/wallet.module';
import { SmsFulfillProcessor } from './processors/sms-fulfill.processor';
import { SmsPollProcessor } from './processors/sms-poll.processor';
import { SmsSyncProcessor } from './processors/sms-sync.processor';
import { SmsAdminController } from './sms-admin.controller';
import { SmsCatalogService } from './sms-catalog.service';
import { SmsController } from './sms.controller';
import { SmsFulfillmentService } from './sms-fulfillment.service';
import { SmsOrdersService } from './sms-orders.service';
import { SmsPricingService } from './sms-pricing.service';
import { SmsSyncScheduler } from './sms-sync.scheduler';
import { SmsSyncService } from './sms-sync.service';
import {
  SMSPOOL_FULFILL_QUEUE,
  SMSPOOL_POLL_QUEUE,
  SMSPOOL_SYNC_QUEUE,
} from './sms.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: SMSPOOL_SYNC_QUEUE },
      { name: SMSPOOL_FULFILL_QUEUE },
      { name: SMSPOOL_POLL_QUEUE },
    ),
    SmsPoolModule,
    WalletModule,
    FulfillmentModule,
  ],
  controllers: [SmsController, SmsAdminController],
  providers: [
    SmsCatalogService,
    SmsPricingService,
    SmsSyncService,
    SmsSyncScheduler,
    SmsOrdersService,
    SmsFulfillmentService,
    SmsSyncProcessor,
    SmsFulfillProcessor,
    SmsPollProcessor,
  ],
  exports: [SmsCatalogService, SmsOrdersService, SmsFulfillmentService],
})
export class SmsModule {}
