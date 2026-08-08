import { Module } from '@nestjs/common';
import { ClerkModule } from '../integrations/clerk/clerk.module';
import { CatalogModule } from '../catalog/catalog.module';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { OrdersModule } from '../orders/orders.module';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    ClerkModule,
    UsersModule,
    CatalogModule,
    OrdersModule,
    WalletModule,
    EsimAccessModule,
  ],
  controllers: [AdminController],
})
export class AdminModule {}
