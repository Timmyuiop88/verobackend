/**
 * A request SMSPool understood and permanently rejected (OOS, bad id,
 * insufficient prepaid balance). Retrying the identical request cannot
 * succeed — callers fail fast and refund.
 */
export class SmsPoolBusinessError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly errorCode: string | undefined,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'SmsPoolBusinessError';
  }
}
