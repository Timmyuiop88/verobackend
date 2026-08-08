# eSIM Top-Up — Frontend Guide

Adds data/validity to an **existing, already-allocated** eSIM. A top-up is a normal
wallet-debiting purchase under the hood — same `PAID → FULFILLING → COMPLETED/FAILED/REFUNDED`
lifecycle as a fresh purchase — but it targets an existing eSIM instead of creating a new one.

Purchases still go through `POST /orders`. Everything about an eSIM *after* it's been
bought — status, data balance, install details, and now top-ups — lives under the
`/esims` facade, which is asset-shaped ("my eSIMs") instead of transaction-shaped
("my orders").

> **What changed:** top-up tiers are no longer quoted live from the provider on every
> request. They're now an **admin-curated catalog** (`TopUpProduct`), synced/reviewed/priced
> the same way base products are — see `TradeVero_docs/admin-product-sync.md`. Nothing in
> the endpoints, request/response shapes, or recommended flow below changed for you; only
> where the data comes from (fast DB read instead of a live provider call per request).

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/esims` | List all my eSIMs (one per purchase), with status + data balance |
| `GET` | `/esims/:id` | One eSIM's status + data balance |
| `GET` | `/esims/:id/topup-packages` | Admin-approved, priced top-up tiers for this eSIM's plan |
| `POST` | `/esims/:id/topup` | Charge wallet + queue a top-up |
| `GET` | `/esims/:id/topups` | Top-up history for this eSIM |

`:id` is the `id` field from `GET /esims` (the underlying `ProviderOrder` id) — **not**
the order id from `GET /orders`. `GET /esims` returns both (`id` and `purchaseOrderId`)
so you can cross-reference if needed.

## Recommended flow

```
1. GET /esims
   → render "My eSIMs" list: name, location, data remaining/used, status badge

2. User taps an eSIM → GET /esims/:id
   → detail screen: same fields, refreshed

3. User taps "Top Up" → GET /esims/:id/topup-packages
   → show package picker: name, data amount, price
   → if the array is empty, hide/disable the button — either this eSIM isn't
     ready yet (not installed), or top-ups simply aren't enabled/published for
     this plan yet

4. User picks a package → POST /esims/:id/topup { "packageCode": "..." }
   → 201: order returned with status FULFILLING — show a spinner/toast,
     same UX as a fresh purchase
   → 409: "A top-up is already in progress for this eSIM" — another top-up
     for this exact eSIM hasn't resolved yet (e.g. a double-tap). Don't retry
     immediately; just show the message and let the in-flight one finish.
   → 400: package no longer available, or the provider rejected this specific
     eSIM as ineligible right now (validity window closed, top-up cap hit,
     etc. — see below). Re-fetch /esims/:id/topup-packages and let the user
     re-pick or try again shortly.

5. Poll GET /esims/:id (or GET /orders/:id) every few seconds until status
   settles: COMPLETED (data added) or FAILED/REFUNDED (money back, show error).
```

## Why the client never sends a price

`POST /esims/:id/topup` takes **only** `packageCode`. The server charges the
admin-approved retail price stored for that tier — a client-supplied amount is never
trusted. This closes the obvious "tamper with the request body to pay less" vector.
Always call `GET /esims/:id/topup-packages` immediately before showing the picker so
the price you display matches what will actually be charged.

## Response shapes

**`GET /esims` / `GET /esims/:id`** — `EsimAssetResponseDto`:

```json
{
  "id": "8f2b...",
  "purchaseOrderId": "a913...",
  "iccid": "8944...",
  "status": "IN_USE",
  "productName": "Europe 5GB 30 Days",
  "locationCode": "EU",
  "canTopUp": true,
  "dataUsedBytes": "1073741824",
  "dataTotalBytes": "5368709120",
  "dataRemainingBytes": "4294967296",
  "dataUsedPercent": 20,
  "expiresAt": "2026-09-06T00:00:00.000Z",
  "activatedAt": "2026-08-07T10:00:00.000Z",
  "createdAt": "2026-08-07T09:00:00.000Z"
}
```

`canTopUp` is `true` only when the eSIM has an `iccid` (i.e. allocated) **and** an admin
has flipped the `topUpEnabled` switch on for the product it was sold under. It's a **soft
hint** for whether to show the "Top Up" button at all — it is not authoritative for
eligibility or price, and it doesn't guarantee `topup-packages` is non-empty (a product
can be `topUpEnabled` with zero `PUBLISHED` tiers yet). Always confirm with
`GET /esims/:id/topup-packages`.

**`GET /esims/:id/topup-packages`** — array of `TopUpPackageResponseDto`:

```json
[
  { "packageCode": "TOPUP-EU-1GB", "name": "1GB Top-Up", "dataVolumeDisplay": "1 GB", "durationDays": 30, "retailPrice": "3.99", "retailPriceUsd": "$3.99", "currency": "USD" }
]
```

**`POST /esims/:id/topup`** and **`GET /esims/:id/topups`** return the same
`OrderResponseDto` shape as `GET /orders/:id`, with `orderType: "TOPUP"` and
`targetEsimId` set to the eSIM it was applied to.

## Safety/reliability notes (for context, not action needed by the frontend)

- **Curated catalog, live final gate**: `GET /esims/:id/topup-packages` is a fast DB read
  of admin-approved tiers (no per-request provider call). Right before charging,
  `POST /esims/:id/topup` still makes one live provider call, scoped to this specific
  eSIM's iccid, to confirm the chosen package is still offered for that exact instance —
  catalog approval controls *what's for sale*, this final check covers *per-instance*
  eligibility (validity window, provider-side top-up cap, suspension, etc.). A `400` here
  means that live check failed even though the tier is published.
- **Concurrency lock**: a Postgres advisory lock scoped to the eSIM id prevents two
  near-simultaneous top-up requests (double-click, retried request) from both
  succeeding and double-charging the same asset — the second gets a `409`.
- **Same fulfillment guarantees as purchase**: the provider call runs through a BullMQ
  queue with retries for transient failures, and permanent provider rejections
  (ineligible package, insufficient provider balance, etc.) auto-refund the wallet
  immediately — see `TradeVero_docs/fulfillment-reliability.md`.
- **Rate limiting**: both `POST /orders` and `POST /esims/:id/topup` are limited to
  5 requests/minute per client on top of the API's global default, as defense in depth
  against abuse beyond what the concurrency lock covers.
