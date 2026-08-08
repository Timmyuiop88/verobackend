import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { OrderUsageResponseDto } from '../orders/dto/order-response.dto';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { EsimAccessService } from '../integrations/esim-access/esim-access.service';
import { USAGE_FRESHNESS_MS } from './usage.constants';
import { toUsageResponse } from './usage.mapper';

/**
 * Serves eSIM data-usage/balance for an order, backed by the `EsimUsage`
 * table with a stale-while-revalidate refresh against eSIM Access.
 *
 * eSIM Access only updates usage numbers on their end every 2-3 hours (their
 * docs are explicit this is not real-time), so there's no benefit to a
 * short cache TTL or a blocking refresh on every request — we serve the
 * last-known snapshot immediately and, if it's past `USAGE_FRESHNESS_MS`,
 * kick off a refresh in the background for the *next* request to pick up.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly esimAccess: EsimAccessService,
    private readonly fulfillmentService: FulfillmentService,
  ) {}

  async getUsageForOrder(
    userId: string,
    orderId: string,
  ): Promise<OrderUsageResponseDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { providerOrder: true },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (order.userId !== userId) {
      throw new ForbiddenException('Order not found');
    }
    const externalOrderId = order.providerOrder?.externalOrderId;
    if (!order.providerOrder?.iccid || !externalOrderId) {
      throw new NotFoundException('Usage not available yet');
    }

    const providerOrder = order.providerOrder;
    let usage = await this.prisma.esimUsage.findUnique({
      where: { providerOrderId: providerOrder.id },
    });

    if (!usage) {
      // Nothing to show at all yet — this one has to block, there's no
      // stale value to fall back to.
      await this.refresh(order.id, externalOrderId);
      usage = await this.prisma.esimUsage.findUnique({
        where: { providerOrderId: providerOrder.id },
      });
    } else if (Date.now() - usage.lastSyncedAt.getTime() > USAGE_FRESHNESS_MS) {
      // Stale-while-revalidate: respond with what we have now, refresh
      // for whoever asks next. Never block a request on this — the
      // provider itself only updates every 2-3 hours, so a few extra
      // seconds of staleness here is immaterial.
      this.refresh(order.id, externalOrderId).catch((error: unknown) => {
        this.logger.warn(
          `Background usage refresh failed for order ${order.id}`,
          error as Error,
        );
      });
    }

    if (!usage) {
      throw new NotFoundException('Usage not available yet');
    }

    return toUsageResponse(order.id, usage);
  }

  private async refresh(
    orderId: string,
    externalOrderId: string,
  ): Promise<void> {
    const queried = await this.esimAccess.queryOrder(externalOrderId);
    const profile = queried.esimList?.[0];
    if (!profile?.iccid) {
      return;
    }

    // Reuses the same idempotent persistence path as the poll/webhook
    // pipeline (upserts ProviderOrder + EsimUsage, no-ops if already
    // terminal, triggers late-fulfillment cleanup if already refunded).
    await this.fulfillmentService.completeFromProfile({
      orderId,
      externalOrderId,
      profile,
      source: 'manual-refresh',
    });
  }
}
