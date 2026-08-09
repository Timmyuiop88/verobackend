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
