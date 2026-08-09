# In-App Notifications — Frontend Guide

**In-app only — not push.** A feed of things that happened to the user's account (wallet
credits/debits, order completion/failure, top-ups), for a notification bell/inbox screen
in the app. No device tokens, no push provider — just a DB-backed feed you poll or fetch
on screen open.

Every event that creates a notification also independently sends a transactional email
(if `EMAIL_ENABLED=true` on the backend) — see the "How this is wired" section below if
you're curious, but the frontend doesn't need to do anything for email; it's automatic.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/notifications` | Paginated feed, newest first |
| `GET` | `/notifications/unread-count` | Just the unread count (cheap, for a badge) |
| `PATCH` | `/notifications/:id/read` | Mark one notification read |
| `PATCH` | `/notifications/read-all` | Mark everything read (e.g. "mark all as read" button) |

All require the usual `Authorization: Bearer <clerk_jwt>` header.

## `GET /notifications`

Query params (all optional): `page` (default 1), `limit` (default 20, max 100),
`unreadOnly` (boolean, default false).

```json
{
  "data": [
    {
      "id": "9f2b1e3a-...",
      "type": "ORDER_COMPLETED",
      "title": "Your eSIM is ready",
      "message": "Japan 5GB 30 Days is ready to install.",
      "data": { "orderId": "a913...", "iccid": "8944..." },
      "read": false,
      "readAt": null,
      "createdAt": "2026-08-08T14:02:11.000Z"
    },
    {
      "id": "7c1a...",
      "type": "WALLET_DEPOSIT",
      "title": "Deposit successful",
      "message": "Your wallet was credited $10.00.",
      "data": { "walletTransactionId": "...", "reference": "deposit_paystack_..." },
      "read": true,
      "readAt": "2026-08-08T13:00:00.000Z",
      "createdAt": "2026-08-08T12:58:40.000Z"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 12, "totalPages": 1, "hasNextPage": false, "hasPreviousPage": false },
  "unreadCount": 3
}
```

`unreadCount` in this response is the **total** unread count regardless of the current
page/filter — use it directly for a badge instead of a separate call, unless you only
need the badge (e.g. on app launch before the notifications screen is opened), in which
case use `GET /notifications/unread-count`.

`data` is a free-form object whose shape depends on `type` — always contains enough IDs
to deep-link (e.g. `orderId` → navigate to that order/eSIM). Don't rely on its shape for
anything user-facing; `title`/`message` are already the display copy.

### `type` values

| Type | Meaning |
|---|---|
| `WALLET_DEPOSIT` | A fiat/crypto deposit landed in the wallet |
| `WALLET_REFUND` | A failed order was refunded |
| `WALLET_ADJUSTMENT` | Support credited or debited the wallet manually |
| `ORDER_COMPLETED` | A fresh eSIM purchase finished provisioning — ready to install |
| `ORDER_FAILED` | A purchase or top-up failed and was refunded |
| `TOPUP_COMPLETED` | A top-up finished successfully |
| `GENERIC` | Reserved for future use — treat unknown types the same as `GENERIC` (render `title`/`message` generically, no special icon) |

## Recommended UI flow

```
1. On app launch / tab focus: GET /notifications/unread-count → badge on the bell icon.
2. User opens the notifications screen: GET /notifications (page 1).
3. Tapping a notification: PATCH /notifications/:id/read, then navigate using `data`
   (e.g. data.orderId → GET /orders/:id or GET /esims/:id).
4. "Mark all as read" button: PATCH /notifications/read-all, then clear the badge locally
   (or re-fetch unread-count).
5. Infinite scroll / pagination: increment `page` using the same `limit`.
```

There's no realtime push here — poll `unread-count` on a reasonable interval (e.g. every
30–60s while the app is foregrounded) or refresh on screen focus. If you later want
realtime delivery (websocket/SSE), the backend can add that on top of the same
`Notification` rows without changing this contract.

## How this is wired (backend context, no frontend action needed)

Notifications are event-driven: business logic (wallet credits, order/top-up completion or
failure) emits a domain event once, and two independent listeners react to it — one
writes the `Notification` row you see here, the other sends the matching email. Either can
fail or be disabled without affecting the other. This means the set of notification types
above will only grow as new events are wired up (e.g. "eSIM expiring soon" is a natural
future addition) — the endpoints and response shape won't need to change.
