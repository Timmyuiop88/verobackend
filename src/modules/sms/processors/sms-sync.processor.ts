import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { SmsSyncService } from '../sms-sync.service';
import { SMSPOOL_SYNC_JOB_NAME, SMSPOOL_SYNC_QUEUE } from '../sms.constants';

type SyncJobData = { trigger: 'cron' | 'admin' };

@Processor(SMSPOOL_SYNC_QUEUE)
export class SmsSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsSyncProcessor.name);

  constructor(private readonly sync: SmsSyncService) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<void> {
    this.logger.log(`SMSPool sync starting (trigger=${job.data.trigger})`);
    const run = await this.sync.run(job.data.trigger);
    this.logger.log(
      `SMSPool sync finished status=${run.status} offers=${run.offersSynced} rentals=${run.rentalSkusSynced}`,
    );
  }
}
