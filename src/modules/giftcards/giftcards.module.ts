import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { ReloadlyModule } from '../integrations/reloadly/reloadly.module';
import { WalletModule } from '../wallet/wallet.module';
import { GiftCardCatalogService } from './giftcard-catalog.service';
import { GiftCardFulfillmentService } from './giftcard-fulfillment.service';
import { GiftCardOrdersService } from './giftcard-orders.service';
import { GiftCardPricingService } from './giftcard-pricing.service';
import { GiftCardRangeService } from './giftcard-range.service';
import { GiftCardReconciliationService } from './giftcard-reconciliation.service';
import { GiftCardSyncScheduler } from './giftcard-sync.scheduler';
import { GiftCardSyncService } from './giftcard-sync.service';
import { GiftCardsAdminController } from './giftcards-admin.controller';
import {
  GIFTCARD_FULFILL_QUEUE,
  GIFTCARD_POLL_QUEUE,
  GIFTCARD_SYNC_QUEUE,
} from './giftcards.constants';
import { GiftCardsController } from './giftcards.controller';
import { GiftCardFulfillProcessor } from './processors/giftcard-fulfill.processor';
import { GiftCardPollProcessor } from './processors/giftcard-poll.processor';
import { GiftCardSyncProcessor } from './processors/giftcard-sync.processor';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: GIFTCARD_SYNC_QUEUE },
      { name: GIFTCARD_FULFILL_QUEUE },
      { name: GIFTCARD_POLL_QUEUE },
    ),
    ReloadlyModule,
    WalletModule,
    // For `refundAndFail` — order refunds are provider-agnostic, so gift
    // cards reuse the eSIM compensation path rather than duplicating it.
    FulfillmentModule,
  ],
  controllers: [GiftCardsController, GiftCardsAdminController],
  providers: [
    GiftCardCatalogService,
    GiftCardPricingService,
    GiftCardSyncService,
    GiftCardSyncScheduler,
    GiftCardOrdersService,
    GiftCardFulfillmentService,
    GiftCardRangeService,
    GiftCardReconciliationService,
    GiftCardSyncProcessor,
    GiftCardFulfillProcessor,
    GiftCardPollProcessor,
  ],
  exports: [
    GiftCardCatalogService,
    GiftCardOrdersService,
    GiftCardFulfillmentService,
  ],
})
export class GiftCardsModule {}
