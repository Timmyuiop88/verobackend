# Post-Purchase eSIM Install Flow

How a frontend should take a user from "payment succeeded" to "eSIM
installed and working," using `GET /orders/:id` and `GET /orders/:id/install`.

## The two endpoints

### 1. `GET /orders/:id` — poll this for order status

```json
{
  "id": "bf8e2153-...",
  "status": "FULFILLING",   // PAID -> FULFILLING -> COMPLETED | FAILED | REFUNDED
  "failureReason": null,
  "esim": null,
  ...
}
```

- **`PAID` / `FULFILLING`** → show a loading state ("Setting up your eSIM…").
  Typical completion time is a few seconds to ~1 minute; poll every 2-3s, or
  just wait for the user to revisit the order.
- **`COMPLETED`** → `esim.iccid` will be set. Move to the install screen and
  call endpoint #2.
- **`FAILED`** → transient, mid-retry. Keep polling (same UI as FULFILLING).
- **`REFUNDED`** → show `failureReason` (e.g.
  `"provider_rejected:200007:Insufficient account balance"` — map known
  prefixes to friendly copy) and refund confirmation. Don't call the install
  endpoint; there's no usable eSIM.

### 2. `GET /orders/:id/install` — call once status is `COMPLETED`

```json
{
  "orderId": "bf8e2153-...",
  "status": "GOT_RESOURCE",
  "iccid": "8997250230001110403",
  "activationCode": "LPA:1$rsp-eu.simlessly.com$D1932272F0E64FBD9578B9A39BC417E1",
  "smdpAddress": "rsp-eu.simlessly.com",
  "matchingId": "D1932272F0E64FBD9578B9A39BC417E1",
  "qrCodeUrl": "https://p.qrsim.net/a7302afe711d41999ca4de60b115a55b.png",
  "shortUrl": "https://p.qrsim.net/a7302afe711d41999ca4de60b115a55b",
  "iosInstallUrl": "https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA%3A1%24rsp-eu.simlessly.com%24D1932272F0E64FBD9578B9A39BC417E1",
  "apn": null,
  "pin": null,
  "puk": null,
  "activatedAt": null,
  "expiresAt": "2027-02-03T04:41:03.000Z"
}
```

Returns `404` with `"eSIM not ready yet — check order status first"` if
called before the order is `COMPLETED`.

Note: `apn`/`pin`/`puk`/`shortUrl` may be `null` on the very first call right
after purchase — the provider backfills these a little after initial
allocation. The endpoint does a best-effort live refresh when they're
missing, so **calling it again a few seconds later** (e.g. if the user
navigates back to the install screen) will usually have them populated.
Don't block the primary install flow (QR/iOS link) on their presence — they're
a secondary fallback, not required for a normal install.

## Recommended UI flow

```
┌─────────────────────────────────────────────┐
│ 1. Detect platform (User-Agent / navigator)  │
└─────────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   iOS 17.4+ Safari        Everything else
        │                       │
        ▼                       ▼
┌─────────────────┐   ┌──────────────────────┐
│ "Install eSIM"   │   │ Show QR code          │
│ button →         │   │ (qrCodeUrl)           │
│ iosInstallUrl     │   │                       │
│ (one tap, opens   │   │ "Can't scan?" →       │
│ Settings)         │   │ show manual entry:    │
└─────────────────┘   │  - SM-DP+: smdpAddress │
                       │  - Code: matchingId    │
                       │  (or full activationCode)│
                       └──────────────────────┘
```

- **iOS 17.4+**: `iosInstallUrl` opens the Settings app directly and starts
  the install — no camera needed. Detect iOS Safari specifically; this link
  does nothing useful on Android or in an in-app webview.
- **Everything else (older iOS, Android, desktop-to-phone)**: render
  `qrCodeUrl` as an `<img>` for the user to scan with their *other* phone's
  camera (can't scan a QR shown on the same device you're installing to).
  Provide a "having trouble scanning?" fallback with a manual-entry form
  pre-filled from `smdpAddress` + `matchingId`.
- **`shortUrl`**: use this instead of `qrCodeUrl` if you want a shareable
  link (e.g. "email me this QR code" / "text me a link") rather than an
  embeddable image.
- **APN/PIN/PUK**: only surface these behind a "still not connecting?" /
  "advanced" disclosure. Almost no one needs them — the eSIM profile itself
  carries the correct network settings on install.

## UX best practices

1. **Don't let the user forget to install.** A QR/activation code is
   typically usable but the profile can occasionally expire or hit download
   limits if left untouched too long — after purchase, treat "install" as
   an explicit step in your flow, not just a details page buried in order
   history.
2. **Confirm installation state**, don't assume. `activatedAt` becomes
   non-null once the provider reports the profile was actually installed
   on a device (via `/esim/query`/webhook `esimStatus` transitioning to
   `IN_USE` or similar) — poll `GET /orders/:id/install` again after
   prompting "Have you installed it?" to reflect real status rather than a
   client-side checkbox.
3. **One eSIM = one physical device.** Warn users clearly: don't try to
   scan the same QR code on a second device — most eSIM profiles are
   single-use per activation, and a second scan can fail entirely or
   silently deactivate the first install (`/esim/query` `esimStatus`
   `RELEASED → GOT_RESOURCE → IN_USE` is a one-way trip per download).
4. **Show validity clearly.** Use `expiresAt` to display "Valid until <date>"
   so users don't install right before a plan lapses — this is also
   returned (with live usage) from `GET /orders/:id/usage` after activation.

### Data balance / usage screen (`GET /orders/:id/usage`)

```json
{
  "orderId": "bf8e2153-...",
  "dataUsedBytes": "104857600",
  "dataTotalBytes": "1073741824",
  "dataRemainingBytes": "968884224",
  "dataUsedPercent": 10,
  "expiresAt": "2027-02-03T04:41:03.000Z",
  "lastSyncedAt": "2026-08-07T05:10:00.000Z",
  "isProviderDataRealtime": false
}
```

- Use `dataRemainingBytes` / `dataUsedPercent` directly — don't recompute
  from `dataUsedBytes`/`dataTotalBytes` yourself, the backend already does
  the subtraction/rounding.
- **Important: `isProviderDataRealtime` is always `false`.** eSIM Access
  only updates usage numbers on their end every 2-3 hours — this is
  documented provider behavior, not a limitation of our polling. Don't
  build a "live meter" UX (e.g. an auto-incrementing progress bar) around
  this number; instead, show `lastSyncedAt` as "Data as of X ago" so users
  understand it isn't instantaneous.
- The backend serves this from its own DB with a background refresh once
  the stored snapshot is >15 minutes old (stale-while-revalidate) — so the
  first call after that window may return a slightly stale number while a
  refresh happens for the *next* call, rather than making the user wait on
  a live provider round-trip. Simply re-fetch after a few seconds if you
  need the freshly-synced value.
5. **Handle the "install failed" case in-app.** If the QR scan or iOS link
   fails, provide a "Try manual entry" fallback (`smdpAddress` +
   `matchingId`) before escalating to support — most install failures are
   scan/network issues, not backend issues.
