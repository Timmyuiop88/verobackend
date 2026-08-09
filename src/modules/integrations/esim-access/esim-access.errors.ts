/**
 * A permanent, business-rule rejection from eSIM Access (e.g. insufficient
 * balance, invalid package, bad parameters). Retrying the exact same request
 * will not succeed — callers should fail fast and compensate (refund)
 * instead of relying on BullMQ retries.
 *
 * Contrast with a `BadGatewayException`, which signals a transient
 * network/5xx failure that IS worth retrying.
 *
 * @see https://docs.esimaccess.com/ (order error codes: 200005-200011, 310xxx, 4xxxxx)
 */
export class EsimAccessBusinessError extends Error {
  constructor(
    public readonly errorCode: string | null | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'EsimAccessBusinessError';
  }
}
