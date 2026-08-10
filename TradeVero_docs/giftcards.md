# Gift Cards (Reloadly)

Sells brand gift cards (Amazon, Steam, Google Play, PlayStation, thousands more) out of the
same USD wallet as eSIMs. Reloadly is the supplier; we are a reseller earning the commission
they pay on each sale.

The shape deliberately mirrors the eSIM flow — sync into a DRAFT catalog, an admin publishes,
the customer pays from their wallet, a queue does the provider call, failures auto-refund —
so there is one mental model for the whole backend. Where it differs, it differs for a
reason, and those reasons are called out below.

---

## 1. How the money works

**Face value is public.** Anyone can buy a $50 Amazon card from Amazon for $50. That kills the
percentage-markup model the eSIM catalog uses (`retail = cost × (1 + markup)`) — nobody knows
what a 5GB Turkey eSIM "should" cost, but everybody knows what a $50 gift card is worth.

Margin comes from Reloadly's **`discountPercentage`** — a commission rebate on what we spend.
Buy a $50 card at 8% and it costs us $46; sell at $49.50 and we keep $3.50 while the customer
saves $0.50 versus buying direct.

The problem is that commission varies enormously across the catalog: plenty of products pay
2%, or 0%. Pricing everything at "face minus a bit" would sell those at a loss.

### The floored hybrid

```
netCost = senderCost + fee − commission
floor   = netCost × (1 + minMarginPercent)      ← never sell below this
target  = faceReference × (1 − customerDiscountPercent)  ← competitive price
retail  = max(floor, target)
ceiling = faceReference × (1 + maxOverFacePercent)

viable  = retail ≤ ceiling  (and margin > 0)
```

`target` keeps well-discounted products attractive. `floor` stops thin-commission products
being sold at a loss. Anything whose floor overshoots the ceiling is marked **non-viable** and
never auto-published — it simply isn't a product we can sell.

Worked examples at the default rule (5% min margin, 1% customer discount, 3% over-face ceiling)
on a $50 card:

| Commission | netCost | floor | target | retail | Margin | Outcome |
|---|---|---|---|---|---|---|
| 8% | $46.00 | $48.30 | $49.50 | **$49.50** | $3.50 | Sold below face — customer saves |
| 2% | $49.00 | $51.45 | $49.50 | **$51.45** | $2.45 | Sold above face, inside ceiling |
| 0% | $50.00 | $52.50 | $49.50 | $52.50 | — | **Non-viable** — exceeds $51.50 ceiling |

The ceiling is the important knob. Retail brand cards should have a low one (nobody pays above
face for Amazon). Gaming top-ups and regional cards tolerate much more, because there is no
convenient direct-purchase alternative — set a `CATEGORY`-scoped rule with
`maxOverFacePercent: 15` and a chunk of the catalog becomes sellable.

### Pricing rules

Rules resolve most-specific-first: **PRODUCT → BRAND → CATEGORY → COUNTRY → GLOBAL**. A
`GLOBAL` rule always exists as the fallback and cannot be deleted. Manage them at
`GET/PUT/DELETE /admin/giftcards/pricing-rules`, then apply with
`POST /admin/giftcards/reprice` — that recomputes every non-overridden denomination without
touching Reloadly, so tuning margins is cheap.

Margin is only *actually* known after the sale. `GiftCardIssuance` stores what the provider
really charged (`amountCharged`, `feePaid`, `discountReceived`, `realizedMargin`), read back
from the transaction rather than the catalog, because prices drift between syncs.
`GET /admin/giftcards/margin-report` aggregates it. A non-zero `negativeMarginOrders` means a
pricing rule needs attention.

---

## 2. Data model

Seven tables, all prefixed `gift_card_`. They are **separate from the eSIM tables** — in
particular `GiftCardCountry` is not `Region`, because the two providers use unrelated code
sets and `Region`'s type/subLocations semantics don't apply.

| Table | Role |
|---|---|
| `gift_card_countries` | Reloadly `/countries`. Independent of the eSIM `regions` table. |
| `gift_card_categories` | Reloadly `/product-categories`, plus our merchandising fields. |
| `gift_card_brands` | Derived from the `brand` embedded in each product. Groups Amazon US / UK / DE. |
| `gift_card_products` | **Parent, not a SKU.** Brand/country/redeem metadata + provider economics. |
| `gift_card_denominations` | **The buyable SKU.** One row per face value, priced and published independently. |
| `gift_card_pricing_rules` | The scoped margin rules above. |
| `gift_card_issuances` | Delivered asset for a `GIFT_CARD` order — Reloadly's counterpart to `ProviderOrder`. |
| `gift_card_sync_runs` | Audit trail for catalog syncs. |

The parent/child split matters: a $5 tier can be unprofitable and stay hidden while the $50
tier of the same product sells. Customers always order a **denomination id**, never a product id.

Orders reuse the existing `orders` table via `orderType = GIFT_CARD` and
`giftCardDenominationId`, so wallet accounting, refunds and the transactions feed all work
unchanged.

---

## 3. Catalog sync

`POST /admin/giftcards/sync` → returns a run id immediately; poll
`GET /admin/giftcards/sync-runs/:id`.

Unlike the eSIM sync (one call, inline in the request) this is a queued background job: ~13k
products across ~70 paginated requests takes minutes. Pages are fetched a few at a time and
written one at a time — concurrent upserts across overlapping brands deadlock.

Everything lands as **DRAFT**. Nothing is ever auto-published.

**Stale sweep.** Reloadly delists products regularly, and leaving them published means selling
cards the provider will reject. Every product seen in a run is stamped with `lastSeenAt`;
what's left behind gets archived. Two guards protect the storefront:

1. If **any page failed**, the sweep is skipped entirely — a partial catalog is
   indistinguishable from mass delisting.
2. If the sweep would archive more than `GIFTCARD_ARCHIVE_SWEEP_MAX_PERCENT` (default 10%) of
   the live catalog, it aborts and alerts.

Either way `sweepSkippedReason` is recorded on the run. Check it — a skipped sweep means stale
products were deliberately left published.

A product Reloadly marks inactive is unpublished on the next sync regardless of the sweep.

**Nightly cron** is off by default (`GIFTCARD_SYNC_CRON_ENABLED=false`). The manual endpoint
always works.

**Discount reconciliation** (`POST /admin/giftcards/reconcile-discounts`) is a much cheaper job
that refreshes commission rates from `/discounts` and reprices only what moved. Since margin is
almost entirely commission, run this far more often than a full sync.

---

## 4. Purchase flow

```
POST /giftcards/orders { denominationId }
  → order created (PAID) + issuance created
  → wallet debited
  → status FULFILLING, fulfill job queued
  → returns immediately

worker: POST /orders to Reloadly
  → SUCCESSFUL           → fetch codes → encrypt → order COMPLETED
  → PENDING / PROCESSING → poll queue (~4-5 min of patience)
  → FAILED / REFUNDED    → refund the customer in full
```

The customer polls `GET /giftcards/orders/:id` until `codeAvailable` is true, then calls
`POST /giftcards/orders/:id/reveal`.

### Not double-charging

`POST /orders` moves real money, so an ambiguous failure (timeout, dropped connection) is
indistinguishable from success. Three mechanisms handle it:

- Our **order id is sent as Reloadly's `customIdentifier`**, so the provider itself rejects a
  duplicate.
- The HTTP client **never auto-retries** the order call.
- Every retry — and the reconciliation sweep — **looks up the identifier first** and adopts the
  existing transaction instead of ordering again. Refunds only happen once the provider
  confirms nothing exists under it.

### Refunds

`FAILED` and `REFUNDED` are not the same thing. `REFUNDED` means Reloadly already reversed its
own charge; `FAILED` means it did not, leaving money with the provider. The customer is made
whole either way, but `FAILED` raises `giftcard_provider_failed_funds_not_reversed` for manual
reconciliation.

### Reconciliation sweeps

- Every 10 min: gift card orders wedged in `FULFILLING` are re-enqueued (safe — see above).
- Every 30 min: issuances marked `SUCCESSFUL` with no stored code have their codes re-fetched.
  The customer paid and the card exists; it just never landed.

### Webhook (preferred over polling alone)

Register in Reloadly Dashboard → Developers → Webhooks:

| Field | Value |
|---|---|
| Endpoint URL | `https://<your-host>/api/v1/webhooks/reloadly` |
| Service | Gift Cards |
| Event | `giftcard_transaction.status` |

Copy the **webhook signing secret** into `RELOADLY_WEBHOOK_SECRET` (this is not `RELOADLY_CLIENT_SECRET`). Locally, point ngrok at the Nest API the same way you do for eSIM Access.

Reloadly signs each POST as HMAC-SHA256 hex of `rawBody + ":" + X-Reloadly-Request-Timestamp`. On `SUCCESSFUL` we fetch codes and complete; on `FAILED` / `REFUNDED` we refund. `PENDING` / `PROCESSING` are no-ops — the poll queue keeps waiting. Idempotent: duplicates are ignored.

Reloadly is **prepaid**. An empty balance fails every order, so the worker checks the balance
before ordering and alerts below `RELOADLY_MIN_BALANCE_ALERT`. Watch
`GET /admin/giftcards/balance`.

---

## 5. Security of card codes

A gift card number is a **bearer instrument** — whoever holds it can spend it. Handling is
therefore stricter than anything else in the codebase:

- Stored only as **AES-256-GCM ciphertext** (`GIFTCARD_ENCRYPTION_KEY`, 32 bytes as 64 hex
  chars). The redemption URL is encrypted too — it embeds the code in its query string.
- Returned by exactly **one endpoint**, `POST /giftcards/orders/:id/reveal`. POST rather than
  GET so the code never reaches server logs, browser history, or a referer header.
- That endpoint is rate limited separately (10/min) and every call increments `revealCount` and
  stamps `revealedAt`, so a compromised account leaves a trail.
- **Never** sent by email or push. Notifications link back into the app instead.
- Provider payloads are stripped of code-shaped fields before being persisted to
  `rawResponse`.
- List endpoints expose only `codeAvailable: boolean`.

Rotating `GIFTCARD_ENCRYPTION_KEY` makes already-issued codes permanently undecryptable. The
ciphertext carries a `v1.` version prefix so a future rotation scheme can decrypt old values.

---

## 6. Custom-amount (RANGE) cards

Some products let the customer name their own amount, so there is no fixed SKU to publish.
`GET /giftcards/:idOrSlug/quote?amount=25` prices one live (calling Reloadly's `/fx-rate` when
the currencies differ) and **materializes a real denomination row**. The client then posts that
`denominationId` to the normal order endpoint — purchase, fulfillment, refund and reveal all
work unchanged.

Amounts must be whole units within the product's range, which bounds how many rows a product
can accumulate. Quotes are priced live; re-quote if the user lingers.

---

## 7. Operator runbook

Getting from zero to selling:

1. Set `RELOADLY_CLIENT_ID` / `RELOADLY_CLIENT_SECRET`, and `GIFTCARD_ENCRYPTION_KEY`
   (`openssl rand -hex 32`). Set the Reloadly account currency to **USD** so no FX is applied
   per sale. Start on `RELOADLY_ENV=sandbox`.
2. Fund the Reloadly balance — it is prepaid.
3. `POST /admin/giftcards/sync`, then poll the run.
4. Review `GET /admin/giftcards?status=DRAFT&viableOnly=true` — the shortlist that can actually
   be sold at a profit.
5. Tune rules if too much is non-viable (usually the over-face ceiling for gaming categories),
   then `POST /admin/giftcards/reprice`.
6. Publish with `PATCH /admin/giftcards/:id/status { "status": "PUBLISHED" }`. This cascades to
   viable denominations only.
7. Turn on `GIFTCARD_SYNC_CRON_ENABLED` once you're happy with the sweep behaviour.

Ops alerts to route somewhere visible (all prefixed `[OPS_ALERT]`):

| Alert | Meaning |
|---|---|
| `giftcard_provider_balance_exhausted` | Sales are failing. Top up now. |
| `giftcard_provider_balance_low` | Below the configured threshold. |
| `giftcard_provider_failed_funds_not_reversed` | Customer refunded; money still with Reloadly. |
| `giftcard_duplicate_without_transaction` | Provider says the id is used but won't show it. **Do not refund blindly.** |
| `giftcard_sold_at_negative_margin` | Provider price moved between sync and sale. |
| `giftcard_sync_sweep_skipped` | Stale products left published on purpose. |
| `giftcard_successful_without_codes` | Card issued but code not fetched — sweep will retry. |

---

## 8. API surface

**Public** (`giftcards` tag)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/giftcards/countries` | Gift-card countries — *not* `/regions` |
| `GET` | `/giftcards/categories` | |
| `GET` | `/giftcards/brands` | Autocomplete |
| `GET` | `/giftcards` | Browse published cards, paginated |
| `GET` | `/giftcards/:idOrSlug` | One card with its buyable denominations |
| `GET` | `/giftcards/:idOrSlug/quote?amount=` | Price a custom (RANGE) amount |
| `POST` | `/giftcards/orders` | Buy — auth required, 5/min |
| `GET` | `/giftcards/orders` | My gift card orders |
| `GET` | `/giftcards/orders/:id` | Poll for `codeAvailable` |
| `POST` | `/giftcards/orders/:id/reveal` | **The only code-returning endpoint.** 10/min |

**Admin** (`admin` tag, Clerk admin role)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/admin/giftcards/sync` | Start a catalog sync (async) |
| `GET` | `/admin/giftcards/sync-runs`, `/sync-runs/:id` | Progress + audit |
| `GET` | `/admin/giftcards/balance` | Reloadly prepaid balance |
| `GET`/`PUT` | `/admin/giftcards/pricing-rules` | List / upsert |
| `DELETE` | `/admin/giftcards/pricing-rules/:id` | GLOBAL cannot be deleted |
| `POST` | `/admin/giftcards/reprice` | Apply rules to the catalog |
| `POST` | `/admin/giftcards/reconcile-discounts` | Refresh commissions, reprice what moved |
| `GET` | `/admin/giftcards` | Review queue |
| `GET` | `/admin/giftcards/:id` | One product, all denominations |
| `PATCH` | `/admin/giftcards/:id/status` | Publish / unpublish / archive |
| `PATCH` | `/admin/giftcards/:id/pricing-rule` | Pin to a specific rule |
| `PATCH` | `/admin/giftcards/denominations/:id/status` | Per-tier publish |
| `PATCH` | `/admin/giftcards/denominations/:id/price` | Manual price, survives syncs |
| `GET` | `/admin/giftcards/orders`, `POST .../orders/:id/retry` | Support tools |
| `GET` | `/admin/giftcards/margin-report` | Realized margin |
