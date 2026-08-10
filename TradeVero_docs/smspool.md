# SMSPool — one-time SMS + number rentals

TradeVero sells SMSPool inventory through the wallet, mirroring gift cards:

1. Sync catalog → admin publish
2. Customer buys → wallet debit → BullMQ fulfill
3. Webhook (primary) + poll (backup) deliver SMS / activate rentals
4. Failures auto-refund

## Env

| Variable | Purpose |
|---|---|
| `SMSPOOL_API_KEY` | API key from SMSPool settings |
| `SMSPOOL_BASE_URL` | default `https://api.smspool.net` |
| `SMSPOOL_WEBHOOK_SECRET` | optional shared secret for `X-SmsPool-Secret` |
| `SMSPOOL_MIN_BALANCE_ALERT` | ops alert threshold |
| `SMSPOOL_SYNC_CRON_ENABLED` | nightly sync master switch |
| `SMSPOOL_SMS_TIMEOUT_SECONDS` | cancel+refund if no SMS (default 1200) |

## Webhook

Register in SMSPool Settings → Webhook:

`https://<host>/api/v1/webhooks/smspool`

Payloads handled:

- Incoming SMS: `{ "orderid", "sms", "full_sms", "timestamp" }`
- Incoming rental SMS: `{ "rental_code", "phonenumber", "full_sms", "timestamp" }`
- Auto-extend: `{ "rental_code", "phonenumber", "success", "timestamp" }`

## Admin flow

1. `POST /api/v1/admin/sms/sync`
2. Publish offers / rental SKUs+plans (`PATCH .../status` → `PUBLISHED`)
3. Optional pricing rules (`PUT /api/v1/admin/sms/pricing-rules`) — percent markup + floor

Default GLOBAL rule is **20%** markup, created on first sync.

## Pricing

`retail = max(cost × (1 + markup%), floorAmount?)`

Scopes (most specific wins): `RENTAL_SKU` / `SERVICE` → `COUNTRY` → `GLOBAL`.

## Out of scope (v1)

SMSPool eSIM, carrier lookup, business sub-accounts, vouchers, customer auto-extend billing (manual extend only).
