import { Module } from '@nestjs/common';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PricingService } from './pricing.service';
import { RegionsService } from './regions.service';
import { TopUpCatalogService } from './topup-catalog.service';

@Module({
  imports: [EsimAccessModule],
  controllers: [CatalogController],
  providers: [
    CatalogService,
    PricingService,
    RegionsService,
    TopUpCatalogService,
  ],
  exports: [
    CatalogService,
    PricingService,
    RegionsService,
    TopUpCatalogService,
  ],
})
export class CatalogModule {}
