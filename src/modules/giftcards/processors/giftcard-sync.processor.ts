import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { GiftCardSyncService } from '../giftcard-sync.service';
import { GIFTCARD_SYNC_QUEUE } from '../giftcards.constants';

type SyncJobData = { runId: string };

/**
 * The catalog walk takes minutes and ~70 provider round trips, so unlike the
 * eSIM sync (a single call, run inline in the admin request) it has to live
 * on a queue. The admin endpoint creates the run row and returns its id
 * immediately; progress is read back from `gift_card_sync_runs`.
 */
@Processor(GIFTCARD_SYNC_QUEUE)
export class GiftCardSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(GiftCardSyncProcessor.name);

  constructor(private readonly syncService: GiftCardSyncService) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    this.logger.log(`Starting gift card catalog sync ${job.data.runId}`);
    const run = await this.syncService.run(job.data.runId);
    this.logger.log(
      `Gift card sync ${run.id} finished: ${run.status}, ${run.productsSynced} products, ${run.denominationsSynced} denominations, ${run.productsArchived} archived`,
    );
  }
}
