import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { firstValueFrom } from 'rxjs';
import type { Env } from '../../../config/env.schema';
import { SmsPoolBusinessError } from './smspool.errors';
import type {
  SmsPoolActiveOrder,
  SmsPoolActiveRental,
  SmsPoolBalance,
  SmsPoolCountry,
  SmsPoolPriceRow,
  SmsPoolPurchaseRentalResult,
  SmsPoolPurchaseSmsResult,
  SmsPoolRentalInfo,
  SmsPoolRentalMessagesResult,
  SmsPoolRentalSku,
  SmsPoolRentalStatus,
  SmsPoolService as SmsPoolServiceRow,
  SmsPoolSpecificPrice,
} from './smspool.types';

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_TRANSIENT_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

type FormFields = Record<string, string | number | boolean | undefined | null>;

/**
 * SMSPool HTTP client. Auth is a form-data `key` on every call (no OAuth).
 * Prefer `/request/active` over per-order `/sms/check` to stay under 32 rps.
 */
@Injectable()
export class SmsPoolService {
  private readonly logger = new Logger(SmsPoolService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly webhookSecret: string;
  private readonly minBalanceAlert: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.apiKey = this.config.get('SMSPOOL_API_KEY', { infer: true });
    this.baseUrl = this.config
      .get('SMSPOOL_BASE_URL', { infer: true })
      .replace(/\/$/, '');
    this.webhookSecret = this.config.get('SMSPOOL_WEBHOOK_SECRET', {
      infer: true,
    });
    this.minBalanceAlert = this.config.get('SMSPOOL_MIN_BALANCE_ALERT', {
      infer: true,
    });
  }

  get isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  get minimumBalanceAlertThreshold(): number {
    return this.minBalanceAlert;
  }

  /**
   * SMSPool's dashboard webhook is not HMAC-signed in their public docs.
   * Optional shared secret via `X-SmsPool-Secret` (or query) when you put a
   * gateway in front; empty secret skips verification (local only).
   */
  verifyWebhookSecret(headerSecret?: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn(
        'SMSPOOL_WEBHOOK_SECRET not set; skipping webhook secret verify',
      );
      return true;
    }
    if (!headerSecret) {
      return false;
    }
    try {
      const a = Buffer.from(this.webhookSecret, 'utf8');
      const b = Buffer.from(headerSecret, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  /** Optional HMAC helper if you later proxy-sign payloads yourself. */
  verifyHmac(rawBody: string, signature?: string): boolean {
    if (!this.webhookSecret || !signature) {
      return !this.webhookSecret;
    }
    const expected = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    try {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------

  async listCountries(): Promise<SmsPoolCountry[]> {
    const data = await this.request<SmsPoolCountry[]>(
      'GET',
      '/country/retrieve_all',
      {},
      { requireKey: false },
    );
    return Array.isArray(data) ? data : [];
  }

  async listServices(country?: number | string): Promise<SmsPoolServiceRow[]> {
    const data = await this.request<SmsPoolServiceRow[]>(
      'GET',
      '/service/retrieve_all',
      { country },
      { requireKey: false },
    );
    return Array.isArray(data) ? data : [];
  }

  async listPricing(params?: {
    country?: number | string;
    service?: number | string;
    pool?: number;
  }): Promise<SmsPoolPriceRow[]> {
    const data = await this.request<SmsPoolPriceRow[] | SmsPoolPriceRow>(
      'POST',
      '/request/pricing',
      params ?? {},
    );
    if (Array.isArray(data)) {
      return data;
    }
    if (data && typeof data === 'object' && 'price' in data) {
      return [data as SmsPoolPriceRow];
    }
    return [];
  }

  async getSpecificPrice(params: {
    country: number | string;
    service: number | string;
    pool?: number;
  }): Promise<SmsPoolSpecificPrice> {
    return this.request<SmsPoolSpecificPrice>('POST', '/request/price', params);
  }

  async listRentalSkus(extendable: 0 | 1 = 1): Promise<SmsPoolRentalSku[]> {
    const data = await this.request<{
      success?: number;
      data?: SmsPoolRentalSku[];
      message?: string;
    }>('POST', '/rental/retrieve_all', { type: extendable });

    if (Array.isArray(data)) {
      return data as unknown as SmsPoolRentalSku[];
    }
    if (data?.success === 0) {
      // "No available rentals" is an empty catalog, not a hard failure.
      return [];
    }
    return data?.data ?? [];
  }

  async getRentalStock(id: number, days: number): Promise<number | null> {
    const data = await this.request<{ success?: number; count?: number }>(
      'POST',
      '/rental/stock',
      { id, days },
    );
    return typeof data?.count === 'number' ? data.count : null;
  }

  async getBalance(): Promise<SmsPoolBalance> {
    return this.request<SmsPoolBalance>('POST', '/request/balance', {});
  }

  // ---------------------------------------------------------------------
  // One-time SMS
  // ---------------------------------------------------------------------

  async purchaseSms(params: {
    country: number | string;
    service: number | string;
    pool?: number;
    maxPrice?: number;
    pricingOption?: 0 | 1;
    quantity?: number;
  }): Promise<SmsPoolPurchaseSmsResult> {
    return this.request<SmsPoolPurchaseSmsResult>(
      'POST',
      '/purchase/sms',
      {
        country: params.country,
        service: params.service,
        pool: params.pool,
        max_price: params.maxPrice,
        pricing_option: params.pricingOption ?? 0,
        quantity: params.quantity ?? 1,
      },
      { allowRetry: false },
    );
  }

  async listActiveOrders(): Promise<SmsPoolActiveOrder[]> {
    const data = await this.request<SmsPoolActiveOrder[] | { success?: number }>(
      'POST',
      '/request/active',
      {},
    );
    return Array.isArray(data) ? data : [];
  }

  async cancelSms(orderId: string): Promise<{ success: number; message?: string }> {
    return this.request('POST', '/sms/cancel', { orderid: orderId }, {
      allowRetry: false,
    });
  }

  // ---------------------------------------------------------------------
  // Rentals
  // ---------------------------------------------------------------------

  async purchaseRental(params: {
    id: number;
    days: number;
    serviceId?: number;
  }): Promise<SmsPoolPurchaseRentalResult> {
    return this.request<SmsPoolPurchaseRentalResult>(
      'POST',
      '/purchase/rental',
      {
        id: params.id,
        days: params.days,
        service_id: params.serviceId,
      },
      { allowRetry: false },
    );
  }

  async getRentalStatus(rentalCode: string): Promise<SmsPoolRentalStatus> {
    return this.request('POST', '/rental/retrieve_status', {
      rental_code: rentalCode,
    });
  }

  async getRentalMessages(
    rentalCode: string,
  ): Promise<SmsPoolRentalMessagesResult> {
    return this.request('POST', '/rental/retrieve_messages', {
      rental_code: rentalCode,
    });
  }

  async getRentalInfo(rentalCode: string): Promise<SmsPoolRentalInfo> {
    return this.request('POST', '/rental/info', { rental_code: rentalCode });
  }

  async extendRental(params: {
    rentalCode: string;
    days: number;
  }): Promise<{ success: number; message?: string; expiration_date?: number }> {
    return this.request(
      'POST',
      '/rental/extend',
      { rental_code: params.rentalCode, days: params.days },
      { allowRetry: false },
    );
  }

  async refundRental(
    rentalCode: string,
  ): Promise<{ success: number; message?: string }> {
    return this.request(
      'POST',
      '/rental/refund',
      { rental_code: rentalCode },
      { allowRetry: false },
    );
  }

  async listActiveRentals(): Promise<SmsPoolActiveRental[]> {
    const data = await this.request<SmsPoolActiveRental[] | { success?: number }>(
      'POST',
      '/rental/retrieve',
      {},
    );
    return Array.isArray(data) ? data : [];
  }

  // ---------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'SMSPool is not configured — set SMSPOOL_API_KEY',
      );
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    fields: FormFields,
    options: { allowRetry?: boolean; requireKey?: boolean } = {},
  ): Promise<T> {
    const requireKey = options.requireKey !== false;
    if (requireKey) {
      this.assertConfigured();
    }

    const allowRetry = options.allowRetry !== false;
    let attempt = 0;

    while (true) {
      attempt += 1;
      try {
        return await this.rawRequest<T>(method, path, fields, requireKey);
      } catch (error) {
        if (error instanceof SmsPoolBusinessError) {
          throw error;
        }
        const transient = isTransient(error);
        if (!allowRetry || !transient || attempt >= MAX_TRANSIENT_RETRIES) {
          if (error instanceof BadGatewayException) {
            throw error;
          }
          throw new BadGatewayException(
            `SMSPool request failed: ${(error as Error).message}`,
          );
        }
        const delay = BASE_RETRY_DELAY_MS * attempt;
        this.logger.warn(
          `SMSPool ${path} transient failure (attempt ${attempt}); retrying in ${delay}ms`,
        );
        await sleep(delay);
      }
    }
  }

  private async rawRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    fields: FormFields,
    requireKey: boolean,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const body = new URLSearchParams();
    if (requireKey || this.apiKey) {
      body.set('key', this.apiKey);
    }
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || v === null || v === '') continue;
      body.set(k, String(v));
    }

    const { data, status } = await firstValueFrom(
      this.http.request<T>({
        method,
        url,
        data: method === 'POST' ? body.toString() : undefined,
        params: method === 'GET' ? Object.fromEntries(body) : undefined,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: REQUEST_TIMEOUT_MS,
        validateStatus: () => true,
      }),
    );

    if (status >= 500) {
      throw new BadGatewayException(`SMSPool ${path} returned ${status}`);
    }

    if (isFailureBody(data)) {
      const message =
        typeof (data as { message?: string }).message === 'string'
          ? (data as { message: string }).message
          : `SMSPool ${path} failed`;
      throw new SmsPoolBusinessError(status || 400, undefined, message, data);
    }

    if (status >= 400) {
      throw new SmsPoolBusinessError(
        status,
        undefined,
        `SMSPool ${path} returned ${status}`,
        data,
      );
    }

    return data;
  }
}

function isFailureBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const row = data as { success?: number | boolean };
  return row.success === 0 || row.success === false;
}

function isTransient(error: unknown): boolean {
  if (error instanceof BadGatewayException) return true;
  if (error instanceof AxiosError) {
    return !error.response || (error.response.status ?? 0) >= 500;
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
