import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ClerkModule } from '../integrations/clerk/clerk.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { FULFILL_ORDER_QUEUE } from '../fulfillment/fulfillment.constants';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { UsageModule } from '../usage/usage.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    ClerkModule,
    UsersModule,
    WalletModule,
    FulfillmentModule,
    EsimAccessModule,
    UsageModule,
    BullModule.registerQueue({ name: FULFILL_ORDER_QUEUE }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
