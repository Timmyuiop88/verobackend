import { Logger } from '@nestjs/common';

const logger = new Logger('OpsAlert');

/**
 * Structured, greppable signal for events that a human should review
 * (auto-refunds after exhausted retries, provider fulfillment arriving
 * after a refund, reconciliation sweeps finding stuck orders, etc.).
 *
 * This intentionally has zero external dependencies so it works the same
 * in every environment. Wire it up to Slack/PagerDuty/Sentry by tailing
 * logs for the `[OPS_ALERT]` prefix, or by swapping the Logger call below
 * for a real notification client.
 */
export function opsAlert(
  event: string,
  data: Record<string, unknown> = {},
): void {
  logger.error(`[OPS_ALERT] ${event} ${JSON.stringify(data)}`);
}
