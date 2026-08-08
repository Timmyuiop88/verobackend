/**
 * TEMPORARY eSIM purchase tracing.
 * Grep/remove all `[ESIM_BUY_DEBUG]` / this file when done debugging.
 * Usage: `esimBuyDebug('step', { orderId })`
 */
const TAG = '[ESIM_BUY_DEBUG]';

export function esimBuyDebug(
  step: string,
  data?: Record<string, unknown>,
): void {
  const ts = new Date().toISOString();
  if (data !== undefined) {
    console.log(TAG, ts, step, data);
  } else {
    console.log(TAG, ts, step);
  }
}

export function esimBuyDebugError(
  step: string,
  error: unknown,
  data?: Record<string, unknown>,
): void {
  const message =
    error instanceof Error ? error.message : String(error ?? 'unknown');

  console.error(TAG, new Date().toISOString(), step, {
    ...data,
    error: message,
    stack: error instanceof Error ? error.stack : undefined,
  });
}
