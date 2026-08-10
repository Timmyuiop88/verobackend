/** Walks the Reloadly catalog and writes it into our tables. Long-running — never inline in a request. */
export const GIFTCARD_SYNC_QUEUE = 'giftcard-sync';
export const GIFTCARD_SYNC_JOB_NAME = 'sync';

/** Places the provider order. Not retried on ambiguous failures — see the processor. */
export const GIFTCARD_FULFILL_QUEUE = 'giftcard-fulfill';
export const GIFTCARD_FULFILL_JOB_NAME = 'fulfill';
export const GIFTCARD_FULFILL_JOB_ATTEMPTS = 3;
export const GIFTCARD_FULFILL_JOB_BACKOFF_MS = 5000;

/** Waits out Reloadly PENDING/PROCESSING transactions before pulling codes. */
export const GIFTCARD_POLL_QUEUE = 'giftcard-poll';
export const GIFTCARD_POLL_JOB_NAME = 'poll';
export const GIFTCARD_MAX_POLL_ATTEMPTS = 20;
export const GIFTCARD_POLL_BASE_DELAY_MS = 3000;
export const GIFTCARD_POLL_MAX_DELAY_MS = 15_000;

export function giftCardPollDelayMs(nextAttempt: number): number {
  return Math.min(
    GIFTCARD_POLL_BASE_DELAY_MS * nextAttempt,
    GIFTCARD_POLL_MAX_DELAY_MS,
  );
}

/** Statements per `$transaction` batch when writing synced rows. */
export const SYNC_WRITE_BATCH_SIZE = 250;

/** Reveal endpoint budget — card codes are bearer secrets. */
export const GIFTCARD_REVEAL_RATE_LIMIT = 10;
export const GIFTCARD_REVEAL_RATE_TTL_MS = 60_000;
