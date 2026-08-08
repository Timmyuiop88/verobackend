/**
 * How long a stored usage snapshot is considered "fresh enough" before we
 * bother live-querying the provider again.
 *
 * eSIM Access only updates usage numbers on their end every 2-3 hours (their
 * docs are explicit about this — it is not a real-time meter). Polling more
 * often than that cannot possibly return a newer number, so a short TTL
 * (e.g. 60s) would just waste calls. 15 minutes is a reasonable middle
 * ground: responsive enough for a user who just topped up or reinstalled,
 * without hammering the provider for data that hasn't changed.
 */
export const USAGE_FRESHNESS_MS = 15 * 60 * 1000;
