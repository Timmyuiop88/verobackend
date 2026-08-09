/**
 * `Order.failureReason` is a machine-readable string like
 * `provider_rejected:200007:insufficient stock` or `provider_timeout` —
 * useful for logs/ops but not something to show a customer verbatim. This
 * maps known prefixes to plain-language copy and falls back to a generic
 * message for anything unrecognized.
 */
export function humanizeFailureReason(
  reason: string | null | undefined,
): string {
  if (!reason) {
    return 'the order could not be completed';
  }
  const prefix = reason.split(':')[0];
  switch (prefix) {
    case 'provider_rejected':
      return 'the supplier was unable to provision this order';
    case 'provider_timeout':
    case 'poll_exhausted':
      return 'the supplier took too long to respond';
    case 'insufficient_stock':
      return 'this plan is temporarily out of stock';
    default:
      return 'the order could not be completed';
  }
}
