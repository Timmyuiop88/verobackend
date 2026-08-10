import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_PUBLISHABLE_KEY: z.string().min(1),
  /** Comma-separated list of allowed frontend origins for Clerk's JWT `azp` check (e.g. https://tradevero.vercel.app). Add every deployed frontend origin here — Clerk rejects tokens from origins not in this list. */
  CLERK_AUTHORIZED_PARTIES: z
    .string()
    .default('http://localhost:3000,http://localhost:3001'),
  PAYSTACK_SECRET_KEY: z.string().min(1),
  PAYSTACK_WEBHOOK_SECRET: z.string().min(1),
  /** Charge currency on Paystack. NG merchants: NGN (default). USD only if enabled on your Paystack account. */
  PAYSTACK_CURRENCY: z.string().default('NGN'),
  /** Used when PAYSTACK_CURRENCY=NGN: wallet USD × rate → NGN charged. */
  PAYSTACK_USD_NGN_RATE: z.coerce.number().positive().default(1600),
  OXAPAY_MERCHANT_API_KEY: z.string().min(1),
  OXAPAY_WEBHOOK_SECRET: z.string().min(1),
  ESIM_ACCESS_CODE: z.string().min(1),
  ESIM_SECRET_KEY: z.string().min(1),
  ESIM_BASE_URL: z.string().url().default('https://api.esimaccess.com'),
  ESIM_ACCESS_WEBHOOK_SECRET: z.string().optional().default(''),
  /**
   * Reloadly gift cards. Left optional (rather than `.min(1)` like eSIM Access)
   * so the app still boots without gift-card credentials — ReloadlyService
   * throws a clear "not configured" error on first use instead.
   */
  RELOADLY_CLIENT_ID: z.string().optional().default(''),
  RELOADLY_CLIENT_SECRET: z.string().optional().default(''),
  /** `sandbox` targets giftcards-sandbox.reloadly.com and spends test balance. */
  RELOADLY_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  RELOADLY_AUTH_URL: z
    .string()
    .url()
    .default('https://auth.reloadly.com/oauth/token'),
  /** Shown to the recipient as the sender of the gift card. */
  RELOADLY_SENDER_NAME: z.string().default('TradeVero'),
  /** Reloadly is prepaid — ops alert fires when the balance drops below this (sender currency). */
  RELOADLY_MIN_BALANCE_ALERT: z.coerce.number().nonnegative().default(50),
  /**
   * Webhook signing secret from Reloadly Dashboard → Developers → Webhooks.
   * Different from RELOADLY_CLIENT_SECRET. Empty = signature check skipped
   * (local only — production must set this).
   */
  RELOADLY_WEBHOOK_SECRET: z.string().optional().default(''),
  /**
   * 32-byte key as 64 hex chars, used for AES-256-GCM encryption of gift card
   * numbers/PINs at rest. Generate with `openssl rand -hex 32`. Rotating this
   * makes previously stored codes undecryptable.
   */
  GIFTCARD_ENCRYPTION_KEY: z
    .string()
    .regex(/^$|^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)')
    .optional()
    .default(''),
  /** Master switch for the nightly catalog sync (manual admin trigger still works). */
  GIFTCARD_SYNC_CRON_ENABLED: z.coerce.boolean().default(false),
  GIFTCARD_SYNC_CRON: z.string().default('0 3 * * *'),
  GIFTCARD_SYNC_PAGE_SIZE: z.coerce.number().int().min(1).max(500).default(200),
  /** Parallel product pages in flight. Keep low — Reloadly rate-limits aggressively. */
  GIFTCARD_SYNC_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(3),
  /**
   * Safety valve on the stale-product sweep: if a run would archive more than
   * this share of the live catalog, skip archiving entirely and alert instead.
   * Stops a partial provider outage from emptying the storefront.
   */
  GIFTCARD_ARCHIVE_SWEEP_MAX_PERCENT: z.coerce
    .number()
    .min(0)
    .max(100)
    .default(10),
  /** Master switch. Off by default so local dev without SMTP configured never tries to send. */
  EMAIL_ENABLED: z.coerce.boolean().default(false),
  /** Any SMTP host works here — Resend's SMTP relay (smtp.resend.com, user "resend", pass "<API key>"), Gmail, SES, Mailgun, Postmark, etc. Swapping providers is just changing these env vars. */
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().default(587),
  /** true = implicit TLS (port 465). false = STARTTLS (587) or plain (25). */
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default(''),
  SMTP_FROM_EMAIL: z.string().optional().default('no-reply@tradevero.app'),
  SMTP_FROM_NAME: z.string().optional().default('TradeVero'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const messages = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment variables: ${messages}`);
  }
  return parsed.data;
}
