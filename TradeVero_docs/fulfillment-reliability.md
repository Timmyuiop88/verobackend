# eSIM Fulfillment: Reliability Architecture

This document describes how a paid order becomes a delivered eSIM, and all
the failure-handling machinery around it. It supersedes the earlier
"blocking poll loop inside one BullMQ job" design.

## Why this changed

The original implementation created the provider order, then **blocked the
worker for up to 45 seconds** in a `for` loop calling `/esim/query` every
3s. If the eSIM still wasn't ready after 15 polls, it threw, and only
refunded on the last of 5 BullMQ attempts (~3.75 minutes of wall-clock
worker time per order in the worst case). That works, but it isn't how
production queue systems are built:

- **Blocking a worker slot** for minutes ties up concurrency you need for
  other orders.
- **String-matching an error message** (`"getting resource"`) to decide
  "this is fine, keep polling" is fragile — providers can (and do) reword
  messages.
- **No independent safety net.** If the process crashed mid-loop, the order
  was silently wedged in `FULFILLING` forever.
- **No handling for a late success after refund.** If the customer was
  refunded and the provider *then* finished allocating the eSIM, nothing
  cancelled it — a live, usable eSIM with no paying customer attached to it.
- **The webhook handler duplicated the "mark completed" logic** inline,
  instead of sharing it with the worker, so the two could drift out of sync.

## Architecture

```
POST /orders  (OrdersService.create)
  │  debit wallet, order -> FULFILLING
  ▼
[fulfill-order queue]  FulfillmentProcessor
  │  single fast HTTP call: POST /esim/order
  │  - success            -> upsert ProviderOrder, schedule first poll job, done
  │  - permanent error     -> FulfillmentService.refundAndFail(), done (no retry)
  │  - transient error     -> throw -> BullMQ retries (5x, exponential backoff)
  │                           -> refundAndFail() only after last attempt
  ▼
[poll-esim-order queue]  PollEsimOrderProcessor  (self-rescheduling delayed jobs)
  │  single fast HTTP call: POST /esim/query
  │  - ICCID present       -> FulfillmentService.completeFromProfile(), done
  │  - still allocating    -> schedule next poll job (delay grows 3s -> 15s cap)
  │  - MAX_POLL_ATTEMPTS   -> FulfillmentService.refundAndFail('provider_provisioning_timeout')
  │    reached (~20 polls, ~4-5 min)
  ▼
eSIM Access webhook  POST /webhooks/esim-access
  │  any time, independent of the poll chain
  └─ ICCID present -> FulfillmentService.completeFromProfile()  (same shared path)

[Reconciliation sweep]  ReconciliationService (@Cron, every 5 min)
  └─ finds orders stuck in FULFILLING for >10 min and restarts
     whichever step is missing (fulfill job or poll chain)
```

No step blocks a worker thread waiting on the provider. Every HTTP call to
eSIM Access happens inside a single, fast job execution.

## Key design decisions

### 1. Two queues, not one blocking loop

- **`fulfill-order`** (`FulfillmentProcessor`): creates the provider order.
  This is the only step that uses BullMQ's built-in `attempts` +
  `backoff`, because a failure here (network blip, 5xx) is genuinely worth
  retrying the *same* HTTP call.
- **`poll-esim-order`** (`PollEsimOrderProcessor`): polls
  `/esim/query` for the allocated profile. Each invocation does one HTTP
  call and either finishes or re-enqueues itself as a new delayed job with
  a unique `jobId` (`${orderId}_poll_${attempt}`). This is BullMQ-idiomatic:
  delayed jobs persist in Redis and survive process restarts, unlike an
  in-memory `setTimeout`/blocking loop.

Constants live in `fulfillment.constants.ts` so tuning (attempt counts,
delays, cron schedule) is a one-file change:

| Constant | Value | Meaning |
|---|---|---|
| `FULFILL_JOB_ATTEMPTS` | 5 | BullMQ retries for transient `createOrder` failures |
| `FULFILL_JOB_BACKOFF_MS` | 5000 (exponential) | Backoff between those retries |
| `MAX_POLL_ATTEMPTS` | 20 | Poll chain length before giving up |
| `POLL_BASE_DELAY_MS` / `POLL_MAX_DELAY_MS` | 3000 / 15000 | Growing delay between polls, capped |
| `STUCK_ORDER_THRESHOLD_MS` | 10 min | How stale a `FULFILLING` order must be to count as "stuck" |
| `RECONCILE_CRON` | `*/5 * * * *` | Reconciliation sweep frequency |

### 2. Typed error classification instead of string matching

`EsimAccessService` now distinguishes:

- **`EsimAccessBusinessError`** (`esim-access.errors.ts`) — a permanent,
  provider-rejected `/esim/order` call (bad params, insufficient balance,
  duplicate `transactionId`, etc. — see eSIM Access error codes
  `200005`-`200011`, `3xxxxx`, `4xxxxx`). Retrying the identical request
  will never succeed, so `FulfillmentProcessor` fails fast and refunds
  immediately instead of burning BullMQ attempts.
- **`BadGatewayException`** — a transient network/5xx failure. Worth
  retrying (via BullMQ attempts for `createOrder`, or the next poll for
  `queryOrder`).
- **"Still allocating"** is detected primarily via the documented
  `errorCode === '200010'` ("Profile is being downloaded for the order"),
  with the previously-observed free-text message
  (`/getting resource/i`) kept as a fallback. This is far less brittle than
  matching only on wording.

### 3. `FulfillmentService` — single source of truth for state transitions

Both the poll chain and the webhook handler call into
`FulfillmentService` instead of each having their own copy of "mark
completed" / "refund" logic:

- **`completeFromProfile()`** — idempotently upserts `ProviderOrder` +
  `EsimUsage` from an eSIM profile, then:
  - if the order is `REFUNDED` already → routes to late-fulfillment cleanup
    (see below) instead of "completing" an order the customer was already
    refunded for.
  - if `COMPLETED` already → no-op.
  - otherwise → marks `COMPLETED`.
- **`refundAndFail(orderId, reason)`** — `FAILED` → wallet refund
  (idempotent via the `refund_${orderId}` reference, safe to call more than
  once) → `REFUNDED`. No-ops if already terminal. Always emits an
  `opsAlert('order_auto_refunded', ...)`.
- **`handleLateFulfillment()`** (private) — a profile arrived *after* the
  customer was refunded. The order stays `REFUNDED` (money already moved),
  but the live eSIM can't be left dangling:
  1. Try `POST /esim/cancel` (refundable — works only while
     `esimStatus=GOT_RESOURCE` / `smdpStatus=RELEASED`, i.e. never
     installed).
  2. If that fails (e.g. it was actually installed), fall back to
     `POST /esim/revoke` (non-refundable, but disables it).
  3. Either way, emit `opsAlert('late_fulfillment_after_refund', ...)` so a
     human reviews it — this should be a rare edge case, not a silent no-op.

### 4. Reconciliation sweep (`ReconciliationService`)

A `@Cron('*/5 * * * *')` job finds orders stuck in `FULFILLING` for more
than 10 minutes and restarts whichever step is missing:

- No `ProviderOrder.externalOrderId` yet → re-enqueue the `fulfill` job
  (covers: crash between wallet debit and job scheduling).
- `ProviderOrder` exists but no `iccid` → re-enqueue a poll job at attempt 1
  (covers: crash mid poll-chain, a dropped/lost delayed job, Redis data
  loss, etc.).

This is the backstop for the "what if the process dies at exactly the
wrong moment" class of bugs that pure retry logic can't cover — everything
it does is idempotent, so overlapping with a still-healthy chain is safe
(both paths check `order.status` before doing anything).

### 5. Admin `retry-fulfillment` no longer resurrects refunded orders

`POST /admin/orders/:id/retry-fulfillment` now rejects `COMPLETED` and
`REFUNDED` orders with a `400`. Previously it would happily flip a
`REFUNDED` order back to `FULFILLING` and retry — if that retry then
succeeded, the customer would receive a free eSIM (already refunded) with
no compensating debit. If a refunded order genuinely needs to be fulfilled
again, that's a **support action**: a wallet adjustment debit + a brand
new order, both audited.

### 6. `Order.failureReason`

New nullable column on `Order`, set whenever `refundAndFail()` runs, e.g.:

- `provider_rejected:200007:Insufficient account balance`
- `provider_unavailable:eSIM Access unavailable`
- `provider_provisioning_timeout`

Surfaced in `OrderResponseDto.failureReason` so both admins and (if you
choose to show it) end users can see *why* an order failed/refunded
without grepping logs.

### 7. Ops alerting hook

`src/common/observability/ops-alert.ts` exports `opsAlert(event, data)` —
a structured, `[OPS_ALERT]`-prefixed error log with zero external
dependencies. It's the seam to wire into Slack/PagerDuty/Sentry later
(tail logs for the prefix, or swap the `Logger` call for a real notifier).
Emitted for:

- `order_auto_refunded` — any time a customer is auto-refunded
- `poll_exhausted_refunding` — poll chain gave up
- `late_fulfillment_after_refund` — eSIM arrived after refund (see §3)
- `late_fulfillment_cleanup_failed` — both cancel *and* revoke failed
- `reconciliation_stuck_orders_found` — the sweep found wedged orders

## What this does NOT cover (known remaining gaps)

- **No real notification channel** — `opsAlert` only logs today. Wire it to
  Slack/PagerDuty/Sentry before relying on it in production.
- **No dead-letter / manual-review queue UI** — stuck orders and late
  fulfillments are logged and (for stuck orders) auto-retried, but there's
  no admin dashboard listing them. Query `Order.failureReason` and grep
  `[OPS_ALERT]` in the meantime.
- **Single-instance cron assumption** — `@Cron` runs per process. If you
  ever scale the worker horizontally, either run reconciliation as a
  separate singleton service/pod, or add a distributed lock (e.g. a Redis
  `SET NX` around `sweepStuckOrders()`) to avoid duplicate sweeps (safe
  today because reconciliation actions are idempotent, but wasteful).
- **eSIM Access outage of unknown duration** — if the provider is down for
  longer than the poll window *and* longer than reconciliation is willing
  to retry, orders will eventually be refunded. That's the correct
  customer-facing behavior, but there's no circuit breaker to stop hammering
  a known-down provider in the meantime.
