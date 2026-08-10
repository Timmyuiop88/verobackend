/**
 * A request Reloadly understood and permanently rejected — invalid
 * denomination, product no longer active, insufficient prepaid balance,
 * duplicate customIdentifier. Retrying the identical request cannot succeed,
 * so callers fail fast and refund instead of burning BullMQ attempts.
 *
 * Mirrors EsimAccessBusinessError so both fulfillment pipelines classify
 * provider failures the same way.
 */
export class ReloadlyBusinessError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorCode: string | undefined,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ReloadlyBusinessError';
  }
}

/**
 * Reloadly rejected an order because `customIdentifier` was already used.
 * That is proof the original order went through, so the correct response is
 * to look the existing transaction up rather than charge the customer twice.
 */
export class ReloadlyDuplicateOrderError extends ReloadlyBusinessError {
  constructor(message: string, details?: unknown) {
    super(409, 'DUPLICATE_CUSTOM_IDENTIFIER', message, details);
    this.name = 'ReloadlyDuplicateOrderError';
  }
}
