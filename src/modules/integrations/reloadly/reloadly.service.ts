import { HttpService } from '@nestjs/axios';
import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, type AxiosRequestConfig } from 'axios';
import { createHmac, timingSafeEqual } from 'crypto';
import { firstValueFrom } from 'rxjs';
import type { Env } from '../../../config/env.schema';
import {
  ReloadlyBusinessError,
  ReloadlyDuplicateOrderError,
} from './reloadly.errors';
import type {
  ReloadlyBalance,
  ReloadlyCategory,
  ReloadlyCountry,
  ReloadlyDiscount,
  ReloadlyFxRate,
  ReloadlyOrderRequest,
  ReloadlyPage,
  ReloadlyProduct,
  ReloadlyProductRedeemInstruction,
  ReloadlyRedeemCode,
  ReloadlyTransaction,
} from './reloadly.types';

const LIVE_BASE_URL = 'https://giftcards.reloadly.com';
const SANDBOX_BASE_URL = 'https://giftcards-sandbox.reloadly.com';

const ACCEPT_V1 = 'application/com.reloadly.giftcards-v1+json';
/** Redeem codes only — v2 additionally returns `redemptionUrl`. */
const ACCEPT_V2 = 'application/com.reloadly.giftcards-v2+json';

const MAX_TRANSIENT_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 15_000;
/** Refresh this far ahead of expiry so an in-flight request never races it. */
const TOKEN_REFRESH_SKEW_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

type ReloadlyErrorBody = {
  message?: string;
  errorCode?: string;
  details?: unknown;
};

type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  acceptVersion?: string;
  /** Order creation is not safely retryable on ambiguous failures. */
  allowRetry?: boolean;
};

/**
 * Reloadly Gift Cards client.
 *
 * Differs from EsimAccessService in three ways that drive the design here:
 * OAuth client-credentials tokens must be cached and refreshed (eSIM Access
 * signs every request instead), list endpoints are paginated Spring pages,
 * and the API rate-limits hard enough that a naive page loop gets throttled.
 */
@Injectable()
export class ReloadlyService {
  private readonly logger = new Logger(ReloadlyService.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly authUrl: string;
  private readonly senderName: string;
  private readonly minBalanceAlert: number;
  private readonly webhookSecret: string;

  private cachedToken: { value: string; expiresAt: number } | null = null;
  /** Single-flight guard so N concurrent sync pages trigger one token fetch. */
  private tokenRefresh: Promise<string> | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.clientId = this.config.get('RELOADLY_CLIENT_ID', { infer: true });
    this.clientSecret = this.config.get('RELOADLY_CLIENT_SECRET', {
      infer: true,
    });
    this.baseUrl =
      this.config.get('RELOADLY_ENV', { infer: true }) === 'live'
        ? LIVE_BASE_URL
        : SANDBOX_BASE_URL;
    this.authUrl = this.config.get('RELOADLY_AUTH_URL', { infer: true });
    this.senderName = this.config.get('RELOADLY_SENDER_NAME', { infer: true });
    this.minBalanceAlert = this.config.get('RELOADLY_MIN_BALANCE_ALERT', {
      infer: true,
    });
    this.webhookSecret = this.config.get('RELOADLY_WEBHOOK_SECRET', {
      infer: true,
    });
  }

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  get defaultSenderName(): string {
    return this.senderName;
  }

  get minimumBalanceAlertThreshold(): number {
    return this.minBalanceAlert;
  }

  /**
   * Reloadly signs webhooks as HMAC-SHA256 hex of `rawBody + ":" + timestamp`
   * using the webhook signing secret from the dashboard (not the API client
   * secret). Headers: `X-Reloadly-Signature`, `X-Reloadly-Request-Timestamp`.
   */
  verifyWebhookSignature(params: {
    rawBody: string;
    signature?: string;
    timestamp?: string;
  }): boolean {
    if (!this.webhookSecret) {
      this.logger.warn(
        'RELOADLY_WEBHOOK_SECRET not set; skipping webhook signature verify',
      );
      return true;
    }
    if (!params.signature || !params.timestamp) {
      return false;
    }

    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${params.rawBody}:${params.timestamp}`)
      .digest('hex');

    try {
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(params.signature, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------

  private async getAccessToken(): Promise<string> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Reloadly is not configured — set RELOADLY_CLIENT_ID and RELOADLY_CLIENT_SECRET',
      );
    }

    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.value;
    }
    if (this.tokenRefresh) {
      return this.tokenRefresh;
    }

    this.tokenRefresh = this.fetchAccessToken().finally(() => {
      this.tokenRefresh = null;
    });
    return this.tokenRefresh;
  }

  private async fetchAccessToken(): Promise<string> {
    try {
      const { data } = await firstValueFrom(
        this.http.post<{ access_token: string; expires_in: number }>(
          this.authUrl,
          {
            client_id: this.clientId,
            client_secret: this.clientSecret,
            grant_type: 'client_credentials',
            audience: this.baseUrl,
          },
          {
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: REQUEST_TIMEOUT_MS,
          },
        ),
      );

      const ttlMs = (data.expires_in || 3600) * 1000;
      this.cachedToken = {
        value: data.access_token,
        expiresAt: Date.now() + Math.max(ttlMs - TOKEN_REFRESH_SKEW_MS, 0),
      };
      return data.access_token;
    } catch (error) {
      this.cachedToken = null;
      this.logger.error('Reloadly token request failed', error as Error);
      throw new BadGatewayException('Reloadly authentication failed');
    }
  }

  // ---------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const { allowRetry = method === 'GET' } = options;
    let lastTransientError: unknown;

    for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt += 1) {
      try {
        return await this.execute<T>(method, path, options);
      } catch (error) {
        if (error instanceof ReloadlyBusinessError) {
          throw error;
        }

        const status = this.statusOf(error);
        const isTransient =
          status === undefined || status === 429 || status >= 500;
        if (!isTransient || !allowRetry || attempt === MAX_TRANSIENT_RETRIES) {
          if (error instanceof BadGatewayException) {
            throw error;
          }
          throw new BadGatewayException(
            `Reloadly ${path} unavailable: ${(error as Error).message}`,
          );
        }

        lastTransientError = error;
        await this.delay(this.retryDelayMs(error, attempt));
      }
    }

    throw new BadGatewayException(
      `Reloadly ${path} unavailable: ${(lastTransientError as Error)?.message ?? 'unknown error'}`,
    );
  }

  private async execute<T>(
    method: 'GET' | 'POST',
    path: string,
    options: RequestOptions,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const requestConfig: AxiosRequestConfig = {
      method,
      url: `${this.baseUrl}${path}`,
      headers: {
        Accept: options.acceptVersion ?? ACCEPT_V1,
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      params: this.compactQuery(options.query),
      data: options.body,
      timeout: REQUEST_TIMEOUT_MS,
    };

    try {
      const { data } = await firstValueFrom(
        this.http.request<T>(requestConfig),
      );
      return data;
    } catch (error) {
      const status = this.statusOf(error);

      // A token can be revoked before its stated expiry. Drop the cache and
      // let the retry loop obtain a fresh one.
      if (status === 401) {
        this.cachedToken = null;
        throw error;
      }

      if (
        status !== undefined &&
        status >= 400 &&
        status < 500 &&
        status !== 429
      ) {
        throw this.toBusinessError(status, error);
      }

      throw error;
    }
  }

  private toBusinessError(
    status: number,
    error: unknown,
  ): ReloadlyBusinessError {
    const body = (error as AxiosError<ReloadlyErrorBody>).response?.data;
    const message = body?.message ?? (error as Error).message;
    const errorCode = body?.errorCode;

    if (
      errorCode === 'DUPLICATE_CUSTOM_IDENTIFIER' ||
      /custom\s*identifier.*(exist|duplicate)|duplicate.*custom\s*identifier/i.test(
        message,
      )
    ) {
      return new ReloadlyDuplicateOrderError(message, body?.details);
    }

    this.logger.warn(
      `Reloadly rejected request (${status}${errorCode ? ` ${errorCode}` : ''}): ${message}`,
    );
    return new ReloadlyBusinessError(status, errorCode, message, body?.details);
  }

  private statusOf(error: unknown): number | undefined {
    return (error as AxiosError)?.response?.status;
  }

  private retryDelayMs(error: unknown, attempt: number): number {
    const retryAfter = (error as AxiosError)?.response?.headers?.[
      'retry-after'
    ] as string | undefined;
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
      }
    }
    return Math.min(BASE_RETRY_DELAY_MS * 2 ** attempt, MAX_RETRY_DELAY_MS);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private compactQuery(
    query: RequestOptions['query'],
  ): Record<string, string | number | boolean> | undefined {
    if (!query) {
      return undefined;
    }
    return Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== undefined),
    ) as Record<string, string | number | boolean>;
  }

  // ---------------------------------------------------------------------
  // Catalog
  // ---------------------------------------------------------------------

  /** ~200 rows, unpaginated. */
  listCountries(): Promise<ReloadlyCountry[]> {
    return this.request<ReloadlyCountry[]>('GET', '/countries');
  }

  listCategories(): Promise<ReloadlyCategory[]> {
    return this.request<ReloadlyCategory[]>('GET', '/product-categories');
  }

  /**
   * One page of the product catalog.
   *
   * `global` is a *filter*, not an "include global products too" flag —
   * passing `true` returns only worldwide-redeemable products, which is a
   * handful. It is left unset here so the full catalog comes back.
   */
  async listProductsPage(params: {
    page: number;
    size: number;
    countryCode?: string;
    productCategoryId?: number;
    productName?: string;
    global?: boolean;
  }): Promise<ReloadlyPage<ReloadlyProduct>> {
    const data = await this.request<
      ReloadlyPage<ReloadlyProduct> | ReloadlyProduct[]
    >('GET', '/products', {
      query: {
        page: params.page,
        size: params.size,
        countryCode: params.countryCode,
        productCategoryId: params.productCategoryId,
        productName: params.productName,
        includeRange: true,
        includeFixed: true,
        global: params.global,
      },
    });

    return normalizePage(data, params.page, params.size);
  }

  getProduct(productId: number): Promise<ReloadlyProduct> {
    return this.request<ReloadlyProduct>('GET', `/products/${productId}`);
  }

  async listDiscountsPage(params: {
    page: number;
    size: number;
  }): Promise<ReloadlyPage<ReloadlyDiscount>> {
    const data = await this.request<
      ReloadlyPage<ReloadlyDiscount> | ReloadlyDiscount[]
    >('GET', '/discounts', {
      query: { page: params.page, size: params.size },
    });

    return normalizePage(data, params.page, params.size);
  }

  getProductRedeemInstructions(
    productId: number,
  ): Promise<ReloadlyProductRedeemInstruction> {
    return this.request<ReloadlyProductRedeemInstruction>(
      'GET',
      `/products/${productId}/redeem-instructions`,
    );
  }

  /**
   * Sender-currency cost of a recipient amount. Needed for RANGE products,
   * where the customer picks an arbitrary face value that has no entry in
   * `fixedRecipientToSenderDenominationsMap`.
   */
  getFxRate(params: {
    currencyCode: string;
    amount: number;
  }): Promise<ReloadlyFxRate> {
    return this.request<ReloadlyFxRate>('GET', '/fx-rate', {
      query: { currencyCode: params.currencyCode, amount: params.amount },
    });
  }

  // ---------------------------------------------------------------------
  // Account + orders
  // ---------------------------------------------------------------------

  getBalance(): Promise<ReloadlyBalance> {
    return this.request<ReloadlyBalance>('GET', '/accounts/balance');
  }

  /**
   * Places a real, money-moving order. Never retried automatically: a
   * timeout could mean the order succeeded, so the caller reconciles via
   * `findTransactionByCustomIdentifier` instead.
   */
  orderGiftCard(request: ReloadlyOrderRequest): Promise<ReloadlyTransaction> {
    return this.request<ReloadlyTransaction>('POST', '/orders', {
      body: request,
      allowRetry: false,
    });
  }

  getRedeemCodes(transactionId: number): Promise<ReloadlyRedeemCode[]> {
    return this.request<ReloadlyRedeemCode | ReloadlyRedeemCode[]>(
      'GET',
      `/orders/transactions/${transactionId}/cards`,
      { acceptVersion: ACCEPT_V2 },
    ).then((data) => (Array.isArray(data) ? data : [data]));
  }

  /** Documented as returning a single object, but observed wrapped in an array. */
  async getTransaction(transactionId: number): Promise<ReloadlyTransaction> {
    const data = await this.request<
      ReloadlyTransaction | ReloadlyTransaction[]
    >('GET', `/reports/transactions/${transactionId}`);

    return Array.isArray(data) ? data[0] : data;
  }

  /**
   * Resolves an order by our own identifier — the recovery path when the
   * order call failed ambiguously or returned a duplicate rejection.
   */
  async findTransactionByCustomIdentifier(
    customIdentifier: string,
  ): Promise<ReloadlyTransaction | null> {
    const page = await this.request<
      ReloadlyPage<ReloadlyTransaction> | ReloadlyTransaction[]
    >('GET', '/reports/transactions', {
      query: { customIdentifier, page: 1, size: 10 },
    });

    const transactions = Array.isArray(page) ? page : (page.content ?? []);
    return (
      transactions.find((tx) => tx.customIdentifier === customIdentifier) ??
      transactions[0] ??
      null
    );
  }
}

/**
 * Reloadly's docs sample a bare array for `/products` and `/discounts`, but
 * the live API usually returns a Spring `Page`. Accept either and always
 * hand callers a Page-shaped object so pagination math stays consistent.
 */
function normalizePage<T>(
  data: ReloadlyPage<T> | T[],
  page: number,
  size: number,
): ReloadlyPage<T> {
  if (Array.isArray(data)) {
    return {
      content: data,
      totalElements: data.length,
      totalPages: 1,
      number: Math.max(page - 1, 0),
      size,
      first: true,
      last: true,
      numberOfElements: data.length,
      empty: data.length === 0,
    };
  }

  return {
    ...data,
    content: data.content ?? [],
    totalElements: data.totalElements ?? data.content?.length ?? 0,
    totalPages: data.totalPages ?? 1,
  };
}
