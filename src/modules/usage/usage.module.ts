import { Module } from '@nestjs/common';
import { FulfillmentModule } from '../fulfillment/fulfillment.module';
import { EsimAccessModule } from '../integrations/esim-access/esim-access.module';
import { UsageService } from './usage.service';

/**
 * Usage reads are exposed via OrdersController `GET /orders/:id/usage`.
 * Passive updates also arrive via WebhooksService / the poll pipeline —
 * this module only owns the on-demand, stale-while-revalidate read path.
 */
@Module({
  imports: [EsimAccessModule, FulfillmentModule],
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
