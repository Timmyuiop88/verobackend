# Gift Cards — Frontend Guide

How to browse, display, buy, and reveal Reloadly gift cards from the TradeVero API.

Base path: `/api/v1`. Browse endpoints are **public** (no auth). Buy / orders / reveal need a Clerk Bearer token.

> Gift card countries are **not** eSIM regions. Use `GET /giftcards/countries`, never `GET /regions`.

Related backend notes (ops/pricing): [`giftcards.md`](./giftcards.md).

---

## Screens to build

| Screen | Data source |
|--------|-------------|
| Catalog grid / list | `GET /giftcards` |
| Filters (country, category, brand, search) | `/giftcards/countries`, `/categories`, `/brands` + query params |
| Product detail + amount picker | `GET /giftcards/:idOrSlug` |
| Custom amount (RANGE only) | `GET /giftcards/:idOrSlug/quote?amount=` |
| Checkout | `POST /giftcards/orders` |
| My gift cards | `GET /giftcards/orders` |
| Show code / PIN | `POST /giftcards/orders/:id/reveal` |
| Transactions list row | `GET /transactions` → `category: GIFT_CARD_PURCHASE` |

---

## 1. Display logos (`logoUrl`)

Every published product includes a ready-to-use image URL:

```ts
type GiftCardProduct = {
  logoUrl: string | null; // ← use this for the card tile / detail hero
  brand: { name: string; logoUrl: string | null } | null;
  // ...
};
```

**Resolution (already done by the API):**

1. First Reloadly product logo, else  
2. Brand `logoUrl`, else  
3. `null`

**Recommended UI:**

```tsx
<img
  src={product.logoUrl ?? '/giftcard-placeholder.svg'}
  alt={product.name}
  width={64}
  height={64}
  loading="lazy"
  // Reloadly CDNs are HTTPS; no auth needed to fetch
/>
```

Also available:

| Field | Use |
|-------|-----|
| `product.logoUrl` | Catalog tile + detail (preferred) |
| `product.brand?.logoUrl` | Brand filter chips / brand page header |
| `product.category?.iconUrl` | Category icons (often null) |
| `country.flagUrl` | Country filter list |
| `order.brandLogoUrl` | “My gift cards” list (may be null — fall back to product fetch or placeholder) |

If `logoUrl` is null, show a placeholder with the first letter of `name` or `brand.name`. Do not invent Reloadly CDN URLs.

---

## 2. Catalog browse

### List published cards

```http
GET /api/v1/giftcards?page=1&limit=20
GET /api/v1/giftcards?countryCode=US&q=amazon
GET /api/v1/giftcards?categorySlug=gaming&brandSlug=steam-22
GET /api/v1/giftcards?global=true
```

| Query | Notes |
|-------|--------|
| `page`, `limit` | Default `1` / `20`, max `100` |
| `q` | Search product + brand name |
| `countryCode` | ISO from `/giftcards/countries` (e.g. `US`). **Global** cards are always included for that country |
| `categorySlug` | From `/giftcards/categories` |
| `brandSlug` | From `/giftcards/brands` |
| `global` | `true` = worldwide-only |

**Only published, sellable cards are returned.** Empty catalog usually means admin hasn’t published anything yet (sync lands everything as `DRAFT`).

### Example response item

```json
{
  "id": "3f7b1e2a-....",
  "slug": "amazon-us-5",
  "name": "Amazon US",
  "logoUrl": "https://cdn.reloadly.com/giftcards/....jpg",
  "brand": {
    "id": "...",
    "name": "Amazon",
    "slug": "amazon-2",
    "logoUrl": "https://...."
  },
  "category": {
    "id": "...",
    "name": "Shopping",
    "slug": "shopping",
    "iconUrl": null,
    "featured": false
  },
  "countryCode": "US",
  "global": false,
  "denominationType": "FIXED",
  "recipientCurrencyCode": "USD",
  "userIdRequired": false,
  "redeemInstructionConcise": "Redeem at amazon.com/redeem",
  "redeemInstructionVerbose": "...",
  "denominations": [
    {
      "id": "denom-uuid-....",
      "faceValue": "50.00",
      "faceValueDisplay": "$50.00",
      "price": "49.50",
      "priceDisplay": "$49.50",
      "currency": "USD",
      "savings": "0.50"
    }
  ]
}
```

### Grid card UI (suggested)

```text
┌─────────────────────────┐
│  [logoUrl]              │
│  Amazon US              │
│  From $10.00            │  ← min(denominations.price)
│  Save up to $1.00       │  ← optional: max(savings)
└─────────────────────────┘
```

Use `priceDisplay` / `faceValueDisplay` for display; use `price` / `faceValue` for math.

`savings` is set only when price &lt; face. Hide the “Save” badge when `savings` is `null`.

### Detail page

```http
GET /api/v1/giftcards/amazon-us-5
GET /api/v1/giftcards/{uuid}
```

Either **slug** or **id** works. Prefer slug in URLs (`/gift-cards/amazon-us-5`).

Show:

- `logoUrl` large
- Name, country flag (`GET /giftcards/countries` → match `countryCode`)
- Amount chips from `denominations[]`
- `redeemInstructionConcise` (expand to verbose if needed)
- If `userIdRequired`: show a “Player / account ID” field before checkout

---

## 3. Filters / autocomplete

```http
GET /api/v1/giftcards/countries?q=united
GET /api/v1/giftcards/categories
GET /api/v1/giftcards/brands?q=amaz
```

| Endpoint | Key fields for UI |
|----------|-------------------|
| Countries | `code`, `name`, `flagUrl` |
| Categories | `slug`, `name`, `iconUrl`, `featured` |
| Brands | `slug`, `name`, `logoUrl` |

Country dropdown: show `flagUrl` + `name`, submit `code` as `countryCode`.

---

## 4. Choosing an amount

### FIXED products (`denominationType: "FIXED"`)

Render one button/chip per `denominations[]` entry. On buy, send that row’s **`id`** (denomination id), **not** the product id.

```ts
POST /giftcards/orders
{ "denominationId": selectedDenomination.id }
```

### RANGE products (`denominationType: "RANGE"`)

`denominations` may be empty on the product. Quote a whole-number amount first:

```http
GET /api/v1/giftcards/{slug}/quote?amount=25
```

Response is a normal denomination object (`id`, `price`, `priceDisplay`, …). Then:

```ts
POST /giftcards/orders
{ "denominationId": quoted.id }
```

Re-quote if the user waits a long time — FX/cost can move. Amounts must be **whole units** inside the product’s min/max (API returns 400 otherwise).

---

## 5. Buy (wallet)

```http
POST /api/v1/giftcards/orders
Authorization: Bearer <clerk_jwt>
Content-Type: application/json

{
  "denominationId": "uuid",
  "recipientEmail": "optional@friend.com",
  "externalUserId": "required-if-userIdRequired"
}
```

| Body field | When |
|------------|------|
| `denominationId` | Always — from list/detail/quote |
| `recipientEmail` | Optional; Reloadly may email the code. In-app reveal still works |
| `externalUserId` | Required when `userIdRequired === true` (games top-ups) |

**Response** starts as `status: "FULFILLING"`, `codeAvailable: false`.

Rate limit: 5 requests / minute (same idea as eSIM purchase).

### Poll until ready

```http
GET /api/v1/giftcards/orders/{orderId}
```

| `status` | UI |
|----------|-----|
| `FULFILLING` / `PAID` | Spinner — “Issuing your card…” |
| `COMPLETED` + `codeAvailable: true` | Enable “Reveal code” |
| `FAILED` / `REFUNDED` | Show failure + that wallet was refunded |

Poll every 2–3s for up to ~2 minutes, then show “Taking longer than usual — check My Gift Cards”.

---

## 6. Reveal code (security-sensitive)

Codes are **never** in list responses. Only:

```http
POST /api/v1/giftcards/orders/{orderId}/reveal
Authorization: Bearer <clerk_jwt>
```

```json
{
  "orderId": "...",
  "productName": "Amazon US",
  "faceValue": "50.00",
  "redeemInstructions": "...",
  "cards": [
    {
      "cardNumber": "1234-5678-9012-3456",
      "pinCode": "4821",
      "redemptionUrl": "https://...."
    }
  ]
}
```

**FE rules:**

1. Use **POST**, not GET (keeps codes out of history / referrers / some logs).
2. Only call after an explicit tap (“Show code”) — not on list mount.
3. Prefer one-time display + copy buttons; don’t put codes in push/email UI.
4. Treat `redemptionUrl` like the card number (it often embeds the code).
5. Rate limited (~10/min) — don’t spam on poll.

Any of `cardNumber` / `pinCode` / `redemptionUrl` may be null depending on brand — render what’s present.

---

## 7. My gift cards

```http
GET /api/v1/giftcards/orders
Authorization: Bearer <clerk_jwt>
```

```ts
type GiftCardOrder = {
  id: string;
  status: 'PAID' | 'FULFILLING' | 'COMPLETED' | 'FAILED' | 'REFUNDED' | ...;
  amountDisplay: string;      // "-$49.50" style already formatted for charge
  productName: string | null;
  faceValue: string | null;
  brandLogoUrl: string | null; // may be null — use placeholder
  codeAvailable: boolean;
  redeemInstructions: string | null;
  revealedAt: string | null;
  createdAt: string;
};
```

List row:

```text
[brandLogoUrl]  Amazon US · $50 card
                Completed · Tap to reveal
```

Deep-link from notifications / transactions with `orderId` → detail → reveal.

---

## 8. Transactions feed

```http
GET /api/v1/transactions?category=GIFT_CARD_PURCHASE
```

| Field | Gift card value |
|-------|-----------------|
| `category` | `GIFT_CARD_PURCHASE` |
| `direction` | `debit` |
| `title` | Product name |
| `subtitle` | e.g. `$50.00 card` |
| `meta.orderId` | Deep link |
| `meta.codeAvailable` | Show “View code” when true |

Do **not** expect card numbers in `meta`.

---

## 9. Suggested user flow

```text
Catalog
  → filters (country / category / search)
  → product detail (logo + amounts)
  → optional: quote RANGE amount
  → confirm + wallet balance check
  → POST /giftcards/orders
  → poll GET .../orders/:id until codeAvailable
  → POST .../reveal (on tap)
  → show cardNumber / pin / redemptionUrl + redeem instructions
```

Wallet balance: `GET /wallet` before checkout; if `balance < denomination.price`, send user to deposit first (`POST /payments/paystack/initialize`).

---

## 10. Empty / error states

| Situation | Cause | FE copy |
|-----------|--------|---------|
| `GET /giftcards` → `data: []` | Nothing published yet | “Gift cards coming soon” / ask admin to publish |
| 404 on detail | Draft/archived or bad slug | Not found |
| 400 on order + `userIdRequired` | Missing `externalUserId` | Ask for game/account ID |
| 400 insufficient balance | Wallet too low | Deposit flow |
| Reveal 400 | Still fulfilling | Keep polling |
| Reveal 404 | Codes not stored yet | Retry shortly |

---

## 11. TypeScript shapes (minimal)

```ts
type GiftCardDenomination = {
  id: string;
  faceValue: string;
  faceValueDisplay: string;
  price: string;
  priceDisplay: string;
  currency: string;
  savings: string | null;
};

type GiftCardProduct = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
  brand: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  } | null;
  category: {
    id: string;
    name: string;
    slug: string;
    iconUrl: string | null;
    featured: boolean;
  } | null;
  countryCode: string | null;
  global: boolean;
  denominationType: 'FIXED' | 'RANGE';
  recipientCurrencyCode: string;
  userIdRequired: boolean;
  redeemInstructionConcise: string | null;
  redeemInstructionVerbose: string | null;
  denominations: GiftCardDenomination[];
};
```

---

## Quick endpoint map

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/giftcards` | No |
| `GET` | `/giftcards/:idOrSlug` | No |
| `GET` | `/giftcards/:idOrSlug/quote?amount=` | No |
| `GET` | `/giftcards/countries` | No |
| `GET` | `/giftcards/categories` | No |
| `GET` | `/giftcards/brands` | No |
| `POST` | `/giftcards/orders` | Yes |
| `GET` | `/giftcards/orders` | Yes |
| `GET` | `/giftcards/orders/:id` | Yes |
| `POST` | `/giftcards/orders/:id/reveal` | Yes |

Swagger: `/api/docs` → tag **giftcards**.
