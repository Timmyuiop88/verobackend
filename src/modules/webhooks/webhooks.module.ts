import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { OxapayModule } from '../integrations/oxapay/oxapay.module';
import { PaystackModule } from '../integrations/paystack/paystack.module';
import { WalletModule } from '../wallet/wallet.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

@Module({
  imports: [
    PaystackModule,
    OxapayModule,
    EsimAccessModule,
    WalletModule,
    FulfillmentModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
