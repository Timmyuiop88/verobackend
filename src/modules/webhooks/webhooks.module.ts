import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { GiftCardsModule } from '../giftcards/giftcards.module';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { OxapayModule } from '../integrations/oxapay/oxapay.module';
import { PaystackModule } from '../integrations/paystack/paystack.module';
import { ReloadlyModule } from '../integrations/reloadly/reloadly.module';
import { SmsPoolModule } from '../integrations/smspool/smspool.module';
import { SmsModule } from '../sms/sms.module';
import { WalletModule } from '../wallet/wallet.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    PaystackModule,
    OxapayModule,
    EsimAccessModule,
    ReloadlyModule,
    SmsPoolModule,
    GiftCardsModule,
    SmsModule,
    WalletModule,
    FulfillmentModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
