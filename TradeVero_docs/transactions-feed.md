# Transactions Feed — Frontend Guide

One unified, paginated, filterable timeline covering everything that has ever moved
money on the account — eSIM purchases, eSIM top-ups, gift card purchases, wallet deposits,
refunds, and support adjustments — instead of stitching together `GET /orders` and
`GET /wallet` yourself. This is what should power a "Transactions" screen with date range /
type / category / status filters and All / Completed / Pending / Failed tabs.

> **Scope note:** categories like "Rent a Number" that you may have seen in other product
> mockups **are not part of TradeVero** yet. The `category` field below is deliberately
> designed so those can be added later as new categories in the *same* feed, without any
> breaking change to this endpoint's shape — that is exactly how `GIFT_CARD_PURCHASE` was
> added.

## Endpoint

`GET /transactions` — requires `Authorization: Bearer <clerk_jwt>`.

### Query params (all optional)

| Param | Type | Notes |
|---|---|---|
| `page` | number | default `1` |
| `limit` | number | default `20`, max `100` |
| `category` | `ESIM_PURCHASE` \| `ESIM_TOPUP` \| `GIFT_CARD_PURCHASE` \| `WALLET_DEPOSIT` \| `WALLET_REFUND` \| `WALLET_ADJUSTMENT` | "Category" dropdown |
| `type` | `credit` \| `debit` | "Type" dropdown — credit = money in, debit = money out |
| `status` | `COMPLETED` \| `PENDING` \| `FAILED` | "Status" dropdown / the All/Completed/Pending/Failed tabs |
| `dateFrom` | date (`YYYY-MM-DD`) | inclusive start of the "Date Range" picker |
| `dateTo` | date (`YYYY-MM-DD`) | inclusive end of the "Date Range" picker |

## Response — `TransactionFeedItemDto[]`

```json
{
  "data": [
    {
      "id": "order:3f7b1e2a-...",
      "category": "ESIM_PURCHASE",
      "direction": "debit",
      "title": "eSIM — Turkey 1GB / 7 Days",
      "subtitle": "1 GB · 7 Days",
      "amount": "4.99",
      "amountDisplay": "-$4.99",
      "currency": "USD",
      "status": "COMPLETED",
      "rawStatus": "COMPLETED",
      "reference": "3f7b1e2a-...",
      "date": "2026-08-08T10:12:00.000Z",
      "meta": { "orderId": "3f7b1e2a-...", "targetEsimId": null, "providerOrderId": "8f2b...", "failureReason": null }
    },
    {
      "id": "wallet:7c1a9e11-...",
      "category": "WALLET_DEPOSIT",
      "direction": "credit",
      "title": "Wallet deposit",
      "subtitle": null,
      "amount": "10.00",
      "amountDisplay": "+$10.00",
      "currency": "USD",
      "status": "COMPLETED",
      "rawStatus": "COMPLETED",
      "reference": "deposit_paystack_...",
      "date": "2026-08-07T09:00:00.000Z",
      "meta": { "walletTransactionId": "7c1a9e11-...", "reference": "deposit_paystack_..." }
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 34, "totalPages": 2, "hasNextPage": true, "hasPreviousPage": false }
}
```

### Field notes

- **`id`** is a composite string (`order:<uuid>` or `wallet:<uuid>`) — this feed merges two
  different underlying tables, so it's not a single DB row's id. Use it as a React
  key / dedupe key, not as an id to call other endpoints with directly — use the ids
  inside `meta` for that (`meta.orderId` → `GET /orders/:id`, etc.).
- **`amountDisplay`** is pre-formatted and signed (`+`/`-`) — render it directly, no need
  to re-derive sign/currency formatting from `amount` + `direction` yourself.
- **`status`** is normalized to exactly three values so it maps 1:1 onto an
  All/Completed/Pending/Failed tab UI. `rawStatus` carries the original underlying
  `OrderStatus`/`WalletTransactionStatus` value if you ever need finer detail (e.g.
  distinguishing `FAILED` vs `REFUNDED`, both of which normalize to `FAILED` here).
- **eSIM purchases/top-ups never double-count as wallet debits** — the wallet-side
  `PURCHASE`-type ledger entries that fund them are intentionally excluded from this feed
  since the `ESIM_PURCHASE`/`ESIM_TOPUP` item already represents that spend.

## Recommended UI flow

```
1. Screen open: GET /transactions?page=1&limit=20 (no filters) → render list + pagination.
2. Tabs (All/Completed/Pending/Failed): re-fetch with status=<tab> (omit for "All").
3. Filters drawer (Date Range/Type/Category/Status): re-fetch with the corresponding params;
   reset to page=1 whenever filters change.
4. Row tap: use `meta` to deep-link —
   - ESIM_PURCHASE/ESIM_TOPUP → GET /orders/:meta.orderId or GET /esims/:meta.providerOrderId
   - WALLET_* → nothing further to fetch; the row already has everything, or link to
     GET /wallet for the running ledger view.
5. Pull-to-refresh / infinite scroll: same endpoint, increment `page`.
```

## Notifications, too

Most of the events represented here (deposits, order completion/failure, top-ups) also
raise an in-app notification and email at the moment they happen — see
`TradeVero_docs/notifications.md`. The transactions feed is the durable, filterable
system-of-record view; notifications are the "just happened" nudge.
