# SMS & Number Rentals — Frontend Guide

How to browse, buy, and use SMSPool **one-time verification numbers** and **multi-day rentals** from the TradeVero API.

Base path: `/api/v1`. **All `/sms/*` routes require a Clerk Bearer token** (catalog included).

> SMS countries/services are **not** eSIM regions or gift-card countries. Use `GET /sms/countries` and `GET /sms/services`.

Related backend notes: [`smspool.md`](./smspool.md).

---

## Screens to build

| Screen | Data source |
|--------|-------------|
| One-time catalog (service × country) | `GET /sms/offers` + filters |
| Service picker | `GET /sms/services?q=` |
| Country picker | `GET /sms/countries` |
| Checkout one-time | `POST /sms/verifications` |
| Waiting for code / show code | `GET /sms/verifications/:orderId` + notifications |
| My verifications | `GET /sms/verifications` |
| Rental catalog | `GET /sms/rentals/catalog` |
| Checkout rental | `POST /sms/rentals` |
| Rental detail + inbox | `GET /sms/rentals/:id` |
| Extend rental | `POST /sms/rentals/:id/extend` |
| Transactions | `GET /transactions` → `SMS_ONE_TIME` / `NUMBER_RENTAL` |

**Empty catalog:** sync creates everything as `DRAFT`. Admin must publish offers / rental SKUs + plans before the storefront shows them.

---

## Auth

```http
Authorization: Bearer <clerk_session_jwt>
```

Insufficient wallet balance → debit fails (same pattern as eSIM / gift cards). Show a top-up CTA.

---

## 1. Browse — one-time SMS

### Countries

```http
GET /api/v1/sms/countries
```

```json
[
  {
    "id": "…",
    "externalId": 1,
    "code": "US",
    "name": "United States",
    "region": "North America"
  }
]
```

### Services (WhatsApp, Telegram, …)

```http
GET /api/v1/sms/services
GET /api/v1/sms/services?q=whats
```

```json
[
  {
    "id": "…",
    "externalId": 846,
    "name": "Snapchat",
    "slug": "snapchat-846"
  }
]
```

Use `id` (UUID) when filtering offers. `externalId` is SMSPool’s numeric id (only needed if you bind a rental to a service).

### Published offers

```http
GET /api/v1/sms/offers?page=1&pageSize=24
GET /api/v1/sms/offers?countryCode=US&serviceId=<uuid>
```

| Query | Notes |
|-------|--------|
| `page`, `pageSize` | Default `1` / `24`, max `100` |
| `countryCode` | ISO from `/sms/countries` (e.g. `US`) |
| `serviceId` | UUID from `/sms/services` |

**Only `PUBLISHED` offers are returned.**

```json
{
  "data": [
    {
      "id": "offer-uuid",
      "pool": 0,
      "providerCost": "0.24",
      "retailPrice": "0.29",
      "currency": "USD",
      "successRate": null,
      "status": "PUBLISHED",
      "service": {
        "id": "…",
        "externalId": 846,
        "name": "Snapchat",
        "slug": "snapchat-846"
      },
      "country": {
        "id": "…",
        "externalId": 1,
        "code": "US",
        "name": "United States",
        "region": "North America"
      }
    }
  ],
  "meta": {
    "page": 1,
    "limit": 24,
    "total": 120,
    "totalPages": 5
  }
}
```

**UI:** show `service.name`, `country.code` / `country.name`, and **`retailPrice`** (customer price). Do not surface `providerCost` in the storefront.

---

## 2. Buy one-time verification

```http
POST /api/v1/sms/verifications
Content-Type: application/json

{ "offerId": "<offer-uuid>" }
```

Wallet is debited immediately; fulfillment runs async.

### Response shape

```json
{
  "id": "order-uuid",
  "status": "FULFILLING",
  "amount": "0.29",
  "currency": "USD",
  "failureReason": null,
  "createdAt": "2026-08-10T12:00:00.000Z",
  "offer": { "id": "…", "retailPrice": "0.29", "service": { "name": "Snapchat" }, "country": { "code": "US" } },
  "verification": {
    "id": "…",
    "status": "PENDING",
    "phoneNumber": null,
    "countryCode": null,
    "smsCode": null,
    "fullSms": null,
    "expiresAt": null
  }
}
```

### Verification status machine

| `verification.status` | Meaning | UI |
|-----------------------|---------|-----|
| `PENDING` | Order created, provider not called yet | Spinner |
| `AWAITING_SMS` | Number issued; waiting for SMS | Show `phoneNumber`, “waiting for code…” |
| `COMPLETED` | SMS arrived | Show `smsCode` + `fullSms` |
| `EXPIRED` / `CANCELLED` / `FAILED` / `REFUNDED` | Timed out or failed; wallet refunded | Error + refund notice |

Order `status` moves `PAID` → `FULFILLING` → `COMPLETED` or `REFUNDED`.

### Recommended wait UX

1. After create, poll `GET /sms/verifications/:orderId` every **3–5s** while `AWAITING_SMS`.
2. Also listen to in-app notifications: type **`SMS_CODE_RECEIVED`** (webhook is usually faster than poll).
3. Stop when `COMPLETED` or terminal failure. Typical timeout is ~20 minutes server-side (`SMSPOOL_SMS_TIMEOUT_SECONDS`); then auto cancel + refund.

```http
GET /api/v1/sms/verifications/:orderId
GET /api/v1/sms/verifications
```

When complete:

```json
{
  "verification": {
    "status": "COMPLETED",
    "phoneNumber": "12025550123",
    "smsCode": "4444",
    "fullSms": "Your code is 4444",
    "expiresAt": "2026-08-10T12:20:00.000Z"
  }
}
```

Codes are returned on the order payload (no separate “reveal” endpoint). Treat them as secrets in logs/analytics.

---

## 3. Browse — number rentals

```http
GET /api/v1/sms/rentals/catalog?page=1&pageSize=24
GET /api/v1/sms/rentals/catalog?countryCode=US
```

Only SKUs with status `PUBLISHED` **and** at least one `PUBLISHED` plan.

```json
{
  "data": [
    {
      "id": "sku-uuid",
      "externalId": 6,
      "name": "United States",
      "slug": "united-states-6",
      "tag": "United States",
      "region": "North America",
      "countryCode": "US",
      "extendable": true,
      "priority": 10,
      "status": "PUBLISHED",
      "country": { "code": "US", "name": "United States" },
      "plans": [
        {
          "id": "plan-uuid",
          "days": 30,
          "providerCost": "20.00",
          "retailPrice": "24.00",
          "currency": "USD",
          "stockCount": null,
          "status": "PUBLISHED"
        }
      ]
    }
  ],
  "meta": { "page": 1, "limit": 24, "total": 12, "totalPages": 1 }
}
```

**Checkout uses `plan.id`**, not the SKU id. Show day tiers as a picker; price = `plan.retailPrice`.

---

## 4. Buy / manage rentals

### Purchase

```http
POST /api/v1/sms/rentals
Content-Type: application/json

{
  "planId": "<plan-uuid>",
  "serviceExternalId": 1108
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `planId` | yes | From catalog `plans[].id` |
| `serviceExternalId` | no | SMSPool service id (`services[].externalId`) if binding the rental to one app |

### Response

```json
{
  "id": "rental-uuid",
  "status": "PENDING",
  "phoneNumber": null,
  "rentalCode": null,
  "days": 30,
  "autoExtend": false,
  "expiresAt": null,
  "order": {
    "id": "order-uuid",
    "status": "FULFILLING",
    "amount": "24.00",
    "currency": "USD"
  },
  "plan": { "id": "…", "days": 30, "retailPrice": "24.00" },
  "sku": {
    "id": "…",
    "name": "United States",
    "countryCode": "US",
    "extendable": true
  },
  "messages": []
}
```

### Rental status machine

| `status` | Meaning | UI |
|----------|---------|-----|
| `PENDING` | Fulfillment not finished | Spinner |
| `PENDING_ACTIVATION` | Ordered; number may take up to ~24h | “Activating…” |
| `ACTIVE` | Usable; inbox works | Show phone + inbox |
| `EXPIRED` | Past `expiresAt` | Offer extend if `sku.extendable` |
| `FAILED` / `REFUNDED` | Failed / refunded | Error |

Notification **`RENTAL_READY`** fires when the number becomes active.

### List / detail / inbox

```http
GET /api/v1/sms/rentals
GET /api/v1/sms/rentals/:id
```

Detail includes recent `messages[]`:

```json
{
  "messages": [
    {
      "id": "…",
      "sender": "1234",
      "fullSms": "Your code is 1234",
      "smsCode": "1234",
      "receivedAt": "2026-08-10T12:05:00.000Z"
    }
  ]
}
```

**Refresh inbox:** poll detail every few seconds while the screen is open, **or** refresh when notification type **`RENTAL_SMS_RECEIVED`** arrives.

### Extend (v1 — manual only)

Only if `sku.extendable === true`. Debits wallet for the chosen day tier (published plan with matching `days` when available).

```http
POST /api/v1/sms/rentals/:id/extend
{ "days": 7 }
```

Auto-extend billing is **not** customer-facing in v1.

### Refund

```http
POST /api/v1/sms/rentals/:id/refund
```

Succeeds only when SMSPool allows a refund for that rental (`403` otherwise). Prefer hiding the button unless you know refunds are available, or catch `403` and show “Not eligible for refund”.

---

## 5. Notifications (in-app feed)

Wire these types from `GET /notifications` (or your existing feed):

| `type` | When | Suggested copy / deep link |
|--------|------|----------------------------|
| `SMS_CODE_RECEIVED` | One-time SMS arrived | Open verification order; show code |
| `SMS_ORDER_FAILED` | One-time failed + refunded | Order detail |
| `RENTAL_READY` | Number active | Open rental detail |
| `RENTAL_SMS_RECEIVED` | New rental inbox message | Open rental inbox |
| `RENTAL_FAILED` | Rental/extend failed + refunded | Order / rental detail |
| `RENTAL_EXPIRED` | Reserved for expiry sweeps | Rental detail |

Payload `data` usually includes `orderId`, and for rentals `rentalId`.

---

## 6. Transactions feed

```http
GET /api/v1/transactions?category=SMS_ONE_TIME
GET /api/v1/transactions?category=NUMBER_RENTAL
```

| `category` | Covers |
|------------|--------|
| `SMS_ONE_TIME` | One-time verification purchases |
| `NUMBER_RENTAL` | Rentals **and** extensions |

`meta` may include `smsCodeAvailable`, `numberRentalId`, `failureReason`.

---

## 7. Suggested user flows

### One-time

```
Pick service → pick country → pick offer (price)
  → POST /verifications
  → show phone when AWAITING_SMS
  → show smsCode when COMPLETED (or from SMS_CODE_RECEIVED)
```

### Rental

```
Pick country / SKU → pick days (plan)
  → optional serviceExternalId
  → POST /rentals
  → wait until ACTIVE / RENTAL_READY
  → inbox on detail; extend when needed
```

---

## 8. Admin (ops UI)

All under `/api/v1/admin/sms`, Clerk + admin role.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/admin/sms/sync` | Enqueue catalog sync |
| `GET` | `/admin/sms/sync/runs` | Recent sync audits |
| `GET` | `/admin/sms/balance` | SMSPool prepaid balance |
| `GET` | `/admin/sms/offers` | All statuses (not only published) |
| `PATCH` | `/admin/sms/offers/:id/status` | `{ "status": "PUBLISHED" }` |
| `PATCH` | `/admin/sms/offers/:id/price` | `{ "retailPrice": "0.50" }` (manual override) |
| `GET` | `/admin/sms/rentals` | SKUs + plans |
| `PATCH` | `/admin/sms/rental-skus/:id/status` | Publish SKU |
| `PATCH` | `/admin/sms/rental-plans/:id/status` | Publish plan |
| `PATCH` | `/admin/sms/rental-plans/:id/price` | Manual plan price |
| `GET`/`PUT` | `/admin/sms/pricing-rules` | Markup % + optional floor |

Publish **both** rental SKU and at least one plan, or the public catalog stays empty for that country.

---

## 9. TypeScript shapes (handy)

```ts
type SmsOffer = {
  id: string;
  pool: number;
  retailPrice: string;
  currency: string;
  service: { id: string; externalId: number; name: string; slug: string };
  country: { id: string; code: string; name: string };
};

type VerificationOrder = {
  id: string;
  status: string;
  amount: string;
  currency: string;
  verification: {
    status:
      | 'PENDING'
      | 'AWAITING_SMS'
      | 'COMPLETED'
      | 'CANCELLED'
      | 'EXPIRED'
      | 'REFUNDED'
      | 'FAILED';
    phoneNumber: string | null;
    smsCode: string | null;
    fullSms: string | null;
    expiresAt: string | null;
  } | null;
  offer: SmsOffer | null;
};

type NumberRental = {
  id: string;
  status:
    | 'PENDING'
    | 'PENDING_ACTIVATION'
    | 'ACTIVE'
    | 'EXPIRED'
    | 'REFUNDED'
    | 'FAILED';
  phoneNumber: string | null;
  days: number;
  expiresAt: string | null;
  sku: { extendable: boolean; name: string; countryCode: string | null };
  messages: Array<{
    id: string;
    sender: string | null;
    fullSms: string;
    smsCode: string | null;
    receivedAt: string;
  }>;
};
```

---

## 10. Gotchas

1. **Auth on catalog** — unlike gift cards, SMS browse is authenticated.
2. **Publish gate** — empty lists almost always mean nothing is `PUBLISHED` yet.
3. **Buy with `offerId` / `planId`** — never SMSPool numeric ids for checkout (except optional `serviceExternalId` on rentals).
4. **Show `retailPrice`**, not `providerCost`.
5. **Phone may arrive before SMS** (one-time) or after a delay (rental activation).
6. **No customer auto-extend** in v1 — only manual `extend`.
7. **Webhook is server-side** — FE does not call SMSPool; rely on poll + notifications.
