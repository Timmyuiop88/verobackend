export const SMSPOOL_SYNC_QUEUE = 'smspool-sync';
export const SMSPOOL_SYNC_JOB_NAME = 'sync';

export const SMSPOOL_FULFILL_QUEUE = 'smspool-fulfill';
export const SMSPOOL_FULFILL_JOB_NAME = 'fulfill';
export const SMSPOOL_FULFILL_JOB_ATTEMPTS = 3;
export const SMSPOOL_FULFILL_JOB_BACKOFF_MS = 5000;

export const SMSPOOL_POLL_QUEUE = 'smspool-poll';
export const SMSPOOL_POLL_JOB_NAME = 'poll';
export const SMSPOOL_MAX_POLL_ATTEMPTS = 40;
export const SMSPOOL_POLL_BASE_DELAY_MS = 5000;
export const SMSPOOL_POLL_MAX_DELAY_MS = 30_000;

export function smsPoolPollDelayMs(nextAttempt: number): number {
  return Math.min(
    SMSPOOL_POLL_BASE_DELAY_MS * Math.ceil(nextAttempt / 2),
    SMSPOOL_POLL_MAX_DELAY_MS,
  );
}

/** Concurrent upserts per wave — no interactive `$transaction`. */
export const SMS_SYNC_WRITE_BATCH_SIZE = 50;
