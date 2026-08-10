import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { GiftCardSyncStatus, type GiftCardSyncRun } from '@prisma/client';
import { Queue } from 'bullmq';
import { CronJob } from 'cron';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env.schema';
import { ReloadlyService } from '../integrations/reloadly/reloadly.service';
import { GiftCardSyncService } from './giftcard-sync.service';
import {
  GIFTCARD_SYNC_JOB_NAME,
  GIFTCARD_SYNC_QUEUE,
} from './giftcards.constants';

const CRON_JOB_NAME = 'giftcard-catalog-sync';
/** A run still RUNNING after this long is treated as dead, not in progress. */
const STALE_RUN_MS = 2 * 60 * 60 * 1000;

/**
 * Schedules the nightly catalog refresh and is the single entry point for
 * kicking off a sync.
 *
 * Unlike the eSIM catalog (a few hundred packages, synced by hand when an
 * admin remembers), the gift card catalog is large and churns constantly, so
 * it runs on a schedule. The cron expression comes from config, so it's
 * registered at runtime rather than through the `@Cron` decorator.
 */
@Injectable()
export class GiftCardSyncScheduler implements OnModuleInit {
  private readonly logger = new Logger(GiftCardSyncScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly syncService: GiftCardSyncService,
    private readonly reloadly: ReloadlyService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly config: ConfigService<Env, true>,
    @InjectQueue(GIFTCARD_SYNC_QUEUE) private readonly syncQueue: Queue,
  ) {}

  onModuleInit(): void {
    const enabled = this.config.get('GIFTCARD_SYNC_CRON_ENABLED', {
      infer: true,
    });
    if (!enabled) {
      this.logger.log(
        'Gift card catalog cron disabled (GIFTCARD_SYNC_CRON_ENABLED=false) — use POST /admin/giftcards/sync',
      );
      return;
    }
    if (!this.reloadly.isConfigured) {
      this.logger.warn(
        'Gift card catalog cron requested but Reloadly credentials are missing — not scheduling',
      );
      return;
    }

    const expression = this.config.get('GIFTCARD_SYNC_CRON', { infer: true });
    const job = new CronJob(expression, () => {
      void this.enqueue('cron').catch((error: Error) =>
        this.logger.error('Scheduled gift card sync failed to enqueue', error),
      );
    });

    this.schedulerRegistry.addCronJob(CRON_JOB_NAME, job);
    job.start();
    this.logger.log(`Gift card catalog sync scheduled (${expression})`);
  }

  /**
   * Creates the run row and queues the work. Refuses to start a second run
   * while one is genuinely in flight — two concurrent walks would fight over
   * `lastSeenAt` and could make the archive sweep see a half-synced catalog.
   */
  async enqueue(trigger: 'cron' | 'admin'): Promise<GiftCardSyncRun> {
    const inFlight = await this.prisma.giftCardSyncRun.findFirst({
      where: {
        status: GiftCardSyncStatus.RUNNING,
        startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (inFlight) {
      this.logger.warn(
        `Gift card sync ${inFlight.id} is still running — not starting another`,
      );
      return inFlight;
    }

    const run = await this.syncService.startRun(trigger);
    await this.syncQueue.add(
      GIFTCARD_SYNC_JOB_NAME,
      { runId: run.id },
      {
        jobId: run.id,
        // The sync is internally fault-tolerant (per-page error capture), so
        // a whole-run retry would redo thousands of writes for no benefit.
        attempts: 1,
        removeOnComplete: 20,
        removeOnFail: 50,
      },
    );
    return run;
  }
}
