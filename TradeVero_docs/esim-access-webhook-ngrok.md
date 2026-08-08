# eSIM Access webhook + ngrok (local)

Configure eSIM Access to push order/status/usage events to your Nest API while developing locally.

Docs:
- Orders / query: [eSIM Access API](https://docs.esimaccess.com/#a0c0f216-b3f2-40a9-b722-718615f88d75)
- Webhooks: [webhook save/query](https://docs.esimaccess.com/#6ff716a7-5b8a-47e2-bcd2-250da94ac325)

## Our webhook endpoint

```text
POST /api/v1/webhooks/esim-access
```

No Clerk auth. Handles:

| `notifyType` | What we do |
|--------------|------------|
| `CHECK_HEALTH` | Ack (sent when you register the URL) |
| `ORDER_STATUS` | Refresh ICCID/LPA from provider; mark order `COMPLETED` when ready |
| `ESIM_STATUS` / `DATA_USAGE` / etc. | Update provider order + usage |

---

## Local setup with ngrok

### 1) Run Nest

```bash
npm run start:dev
# listening on http://localhost:3000
```

### 2) Expose it

```bash
ngrok http 3000
```

Copy the **HTTPS** forwarding URL, e.g. `https://abcd1234.ngrok-free.app`.

### 3) Register with eSIM Access (admin)

```http
POST /api/v1/admin/webhooks/esim-access
Authorization: Bearer <clerk_admin_jwt>
Content-Type: application/json

{
  "webhookUrl": "https://abcd1234.ngrok-free.app/api/v1/webhooks/esim-access"
}
```

Or verify current URL:

```http
GET /api/v1/admin/webhooks/esim-access
Authorization: Bearer <clerk_admin_jwt>
```

On save, eSIM Access usually sends a `CHECK_HEALTH` ping. Watch Nest logs for:

```text
[ESIM_BUY_DEBUG] ... webhook.esim-access.health_ok
```

### 4) Re-register when ngrok URL changes

Free ngrok URLs change on restart. Run step 3 again with the new host.

---

## Optional env

```env
# Leave empty in local/ngrok — signature verify is skipped when unset
ESIM_ACCESS_WEBHOOK_SECRET=
APP_URL=http://localhost:3000
```

If you later set a shared secret, implement matching verify rules with whatever eSIM Access documents for webhook signatures. Until then, empty secret = accept (dev-friendly).

---

## Why this matters for “getting resource”

After `POST /esim/order`, the provider often returns:

```text
the batchOrder has been getting resource, total:[1], success:[0]
```

Meaning: order accepted, profile **not ready yet**. ICCID typically appears within seconds via:

1. Polling `POST /esim/query` (our worker), and/or  
2. `ORDER_STATUS` webhook (fallback — more reliable with ngrok registered)

Without a public webhook URL, you only have polling. With ngrok + registration, completion can arrive even if a poll window was short.

---

## Quick test

1. Register ngrok webhook (step 3).
2. Buy a published product (`POST /orders`).
3. Expect logs: create order → poll / webhook → `order.completed` with ICCID.
4. `GET /orders/:id` should show `status: COMPLETED` and esim payload.
