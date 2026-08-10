import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import type { Env } from '../../config/env.schema';
import {
  SMSPOOL_SYNC_JOB_NAME,
  SMSPOOL_SYNC_QUEUE,
} from './sms.constants';

@Injectable()
export class SmsSyncScheduler {
  private readonly logger = new Logger(SmsSyncScheduler.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(SMSPOOL_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  @Cron(process.env.SMSPOOL_SYNC_CRON ?? '0 4 * * *')
  async enqueueNightly(): Promise<void> {
    const enabled = this.config.get('SMSPOOL_SYNC_CRON_ENABLED', {
      infer: true,
    });
    if (!enabled) return;

    await this.syncQueue.add(
      SMSPOOL_SYNC_JOB_NAME,
      { trigger: 'cron' },
      {
        jobId: `smspool-sync-cron-${new Date().toISOString().slice(0, 13)}`,
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );
    this.logger.log('Enqueued nightly SMSPool catalog sync');
  }

  async enqueueAdmin(): Promise<{ queued: true }> {
    await this.syncQueue.add(
      SMSPOOL_SYNC_JOB_NAME,
      { trigger: 'admin' },
      {
        jobId: `smspool-sync-admin-${Date.now()}`,
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );
    return { queued: true };
  }
}
