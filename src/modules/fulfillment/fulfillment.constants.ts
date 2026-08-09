/** Creates the provider order (single fast HTTP call). BullMQ attempts here only cover transient network/5xx errors. */
export const FULFILL_ORDER_QUEUE = 'fulfill-order';
export const FULFILL_JOB_NAME = 'fulfill';
export const FULFILL_JOB_ATTEMPTS = 5;
export const FULFILL_JOB_BACKOFF_MS = 5000;

/** Polls for eSIM allocation via short, non-blocking delayed jobs instead of a blocking sleep loop. */
export const POLL_ESIM_ORDER_QUEUE = 'poll-esim-order';
export const POLL_JOB_NAME = 'poll';

/** ~20 polls with growing delay (3s, 6s, 9s, ... capped at 15s) ≈ 4-5 min total window before we give up and refund. */
export const MAX_POLL_ATTEMPTS = 20;
export const POLL_BASE_DELAY_MS = 3000;
export const POLL_MAX_DELAY_MS = 15000;

export function nextPollDelayMs(nextAttempt: number): number {
  return Math.min(POLL_BASE_DELAY_MS * nextAttempt, POLL_MAX_DELAY_MS);
}

/** Safety net: catch orders wedged in FULFILLING (crash mid-chain, lost job, etc.) that neither webhook nor polling resolved. */
export const RECONCILE_CRON = '*/5 * * * *';
export const STUCK_ORDER_THRESHOLD_MS = 10 * 60 * 1000;

/** Top-up is a single synchronous provider call (unlike purchase, no separate allocation/poll phase — data lands on an already-installed eSIM immediately). */
export const TOPUP_ORDER_QUEUE = 'topup-order';
export const TOPUP_JOB_NAME = 'topup';
export const TOPUP_JOB_ATTEMPTS = 5;
export const TOPUP_JOB_BACKOFF_MS = 5000;
