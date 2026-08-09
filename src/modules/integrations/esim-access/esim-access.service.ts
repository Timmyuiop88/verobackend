import { createHmac, randomUUID } from 'crypto';
import { HttpService } from '@nestjs/axios';
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import {
  esimBuyDebug,
  esimBuyDebugError,
} from '../../../common/debug/esim-buy-debug';
import type { Env } from '../../../config/env.schema';
import { EsimAccessBusinessError } from './esim-access.errors';

export type EsimPackage = {
  packageCode: string;
  slug: string;
  name: string;
  price: number;
  retailPrice: number;
  currencyCode: string;
  volume: number;
  duration: number;
  durationUnit: string;
  location: string;
  speed?: string;
  supportTopUpType?: number;
};

export type EsimSubLocation = {
  code: string;
  name: string;
};

/** From POST /location/list — type 1 = country, type 2 = multi-country region */
export type EsimLocation = {
  code: string;
  name: string;
  type: number;
  subLocationList?: EsimSubLocation[];
};

type EsimApiResponse<T> = {
  success: boolean;
  errorCode?: string;
  errorMsg?: string | null;
  obj: T;
};

/**
 * A single allocated eSIM profile, as returned by /esim/query (and echoed in
 * webhooks, though webhook payloads are typically a lighter subset). The
 * provider tends to backfill richer fields (apn/pin/puk/shortUrl/activateTime)
 * a short while after initial allocation — treat their absence as "not yet
 * populated" rather than "never available", and re-query on-demand when a
 * user views install details if they're still missing.
 */
export type EsimProfile = {
  esimTranNo: string;
  orderNo: string;
  iccid: string;
  ac: string;
  qrCodeUrl: string;
  smdpStatus: string;
  esimStatus: string;
  expiredTime?: string;
  totalVolume?: number;
  orderUsage?: number;
  shortUrl?: string;
  apn?: string;
  pin?: string;
  puk?: string;
  activateTime?: string | null;
  installationTime?: string | null;
};

/** SM-DP+ still allocating the profile — normal, not a hard failure. */
const PENDING_PROVISIONING_ERROR_CODE = '200010';

/** Response shape of POST /esim/topup — a lighter subset of EsimProfile. */
export type EsimTopUpResult = {
  transactionId: string;
  iccid: string;
  expiredTime?: string;
  totalVolume?: number;
  totalDuration?: number;
  orderUsage?: number;
};

@Injectable()
export class EsimAccessService {
  private readonly logger = new Logger(EsimAccessService.name);
  private readonly accessCode: string;
  private readonly secretKey: string;
  private readonly openApiBaseUrl: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.accessCode = this.config.get('ESIM_ACCESS_CODE', { infer: true });
    this.secretKey = this.config.get('ESIM_SECRET_KEY', { infer: true });
    const baseUrl = this.config
      .get('ESIM_BASE_URL', { infer: true })
      .replace(/\/$/, '');
    this.openApiBaseUrl = baseUrl.endsWith('/api/v1/open')
      ? baseUrl
      : `${baseUrl}/api/v1/open`;
    this.webhookSecret = this.config.get('ESIM_ACCESS_WEBHOOK_SECRET', {
      infer: true,
    });
  }

  /** Convert API price units (x10000) to USD. */
  static apiPriceToUsd(apiPrice: number): number {
    return apiPrice / 10000;
  }

  /**
   * HMAC-SHA256 per eSIM Access auth:
   * signData = RT-Timestamp + RT-RequestID + RT-AccessCode + RequestBody
   * signature = HMAC_SHA256(signData, SecretKey) as lowercase hex
   */
  private buildHeaders(body: string): Record<string, string> {
    const timestamp = Date.now().toString();
    const requestId = randomUUID();
    const signData = `${timestamp}${requestId}${this.accessCode}${body}`;
    const signature = createHmac('sha256', this.secretKey)
      .update(signData)
      .digest('hex')
      .toLowerCase();

    return {
      'Content-Type': 'application/json',
      'RT-AccessCode': this.accessCode,
      'RT-RequestID': requestId,
      'RT-Timestamp': timestamp,
      'RT-Signature': signature,
    };
  }

  private async post<T>(
    endpoint: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const bodyStr = JSON.stringify(body);
    const isBuyPath =
      endpoint === '/esim/order' ||
      endpoint === '/esim/query' ||
      endpoint === '/esim/topup';
    // TEMP: remove [ESIM_BUY_DEBUG] tracing when purchase flow is stable
    if (isBuyPath) {
      esimBuyDebug('esim-access.request', { endpoint, body });
    }
    try {
      const { data } = await firstValueFrom(
        this.http.post<EsimApiResponse<T>>(
          `${this.openApiBaseUrl}${endpoint}`,
          bodyStr,
          { headers: this.buildHeaders(bodyStr) },
        ),
      );

      if (!data.success) {
        const errorMsg = data.errorMsg || 'eSIM Access request failed';
        this.logger.warn(`eSIM Access error ${data.errorCode}: ${errorMsg}`);
        if (isBuyPath) {
          esimBuyDebug('esim-access.response.error', {
            endpoint,
            errorCode: data.errorCode,
            errorMsg,
          });
        }

        // Provider still allocating the eSIM — not a hard failure on query.
        // errorCode 200010 is the documented code; the message regex is a
        // fallback since some responses only surface the free-text message
        // (e.g. "the batchOrder has been getting resource, total:[1], success:[0]").
        if (
          endpoint === '/esim/query' &&
          (data.errorCode === PENDING_PROVISIONING_ERROR_CODE ||
            /getting resource/i.test(errorMsg))
        ) {
          return { esimList: [] } as T;
        }

        // Order/top-up creation errors (bad params, insufficient balance,
        // duplicate transactionId, eSIM not eligible for top-up, etc.) are
        // permanent/business errors — retrying the identical request will
        // not help. Classify separately from transient network/5xx failures
        // so callers can fail fast + refund instead of burning retry attempts.
        if (endpoint === '/esim/order' || endpoint === '/esim/topup') {
          throw new EsimAccessBusinessError(data.errorCode, errorMsg);
        }

        throw new BadGatewayException(errorMsg);
      }

      if (isBuyPath) {
        esimBuyDebug('esim-access.response.ok', {
          endpoint,
          objKeys:
            data.obj && typeof data.obj === 'object'
              ? Object.keys(data.obj)
              : [],
        });
      }

      return data.obj;
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof EsimAccessBusinessError
      ) {
        throw error;
      }
      if (isBuyPath) {
        esimBuyDebugError('esim-access.request.failed', error, { endpoint });
      }
      this.logger.error(`eSIM Access ${endpoint} failed`, error as Error);
      throw new BadGatewayException('eSIM Access unavailable');
    }
  }

  /**
   * Supported countries and regions.
   * @see https://docs.esimaccess.com/#756ec9fa-d16e-4366-98a8-8bad806f9d1a
   */
  async listLocations(): Promise<EsimLocation[]> {
    const obj = await this.post<{ locationList: EsimLocation[] }>(
      '/location/list',
      {},
    );
    return obj.locationList ?? [];
  }

  async listPackages(locationCode = ''): Promise<EsimPackage[]> {
    const obj = await this.post<{ packageList: EsimPackage[] }>(
      '/package/list',
      {
        locationCode,
        type: '',
        slug: '',
        packageCode: '',
        iccid: '',
      },
    );
    return obj.packageList ?? [];
  }

  async createOrder(params: {
    transactionId: string;
    packageCode: string;
    count?: number;
    periodNum?: number;
  }): Promise<{ orderNo: string; transactionId: string }> {
    const packageInfo: Record<string, unknown> = {
      packageCode: params.packageCode,
      count: params.count ?? 1,
    };
    if (params.periodNum !== undefined) {
      packageInfo.periodNum = params.periodNum;
    }

    return this.post('/esim/order', {
      transactionId: params.transactionId,
      packageInfoList: [packageInfo],
    });
  }

  /**
   * Live top-up packages compatible with a specific already-allocated eSIM
   * (queried by iccid). Used only as a final eligibility gate right before
   * charging — the provider is the source of truth for whether THIS instance
   * can still be topped up (validity expiry, the documented 10-top-up cap,
   * suspension, etc.), none of which a catalog-level toggle can know about.
   * Never used for pricing — see `listTopUpPackagesByCode` for that.
   * @see https://docs.esimaccess.com/ (package/list, type=TOPUP)
   */
  async listTopUpPackagesByIccid(iccid: string): Promise<EsimPackage[]> {
    const obj = await this.post<{ packageList: EsimPackage[] }>(
      '/package/list',
      {
        locationCode: '',
        type: 'TOPUP',
        slug: '',
        packageCode: '',
        iccid,
      },
    );
    return obj.packageList ?? [];
  }

  /**
   * Top-up tiers available for a base package, queried by packageCode rather
   * than a live iccid — no allocated eSIM instance required. This is what
   * powers the admin "check top-up prices" review flow at catalog-sync time,
   * before any customer owns an eSIM for this product.
   * @see https://docs.esimaccess.com/ (package/list, type=TOPUP — "Query
   * available Top Up plans with iccid or packageCode")
   */
  async listTopUpPackagesByCode(packageCode: string): Promise<EsimPackage[]> {
    const obj = await this.post<{ packageList: EsimPackage[] }>(
      '/package/list',
      {
        locationCode: '',
        type: 'TOPUP',
        slug: '',
        packageCode,
        iccid: '',
      },
    );
    return obj.packageList ?? [];
  }

  /**
   * Add data/validity to an existing, already-installed eSIM. `transactionId`
   * must be unique per attempt (our Order id) for provider-side idempotency.
   * @see https://docs.esimaccess.com/ (Top Up)
   */
  async topUpEsim(params: {
    transactionId: string;
    packageCode: string;
    iccid: string;
  }): Promise<EsimTopUpResult> {
    return this.post('/esim/topup', {
      transactionId: params.transactionId,
      packageCode: params.packageCode,
      iccid: params.iccid,
    });
  }

  async queryOrder(orderNo: string): Promise<{ esimList: EsimProfile[] }> {
    return this.post('/esim/query', {
      orderNo,
      iccid: '',
      pager: { pageNum: 1, pageSize: 20 },
    });
  }

  async queryUsage(esimTranNoList: string[]): Promise<unknown> {
    return this.post('/esim/usage/query', { esimTranNoList });
  }

  /**
   * Cancel an unused, un-installed eSIM for a full refund to our provider
   * balance. Only works while `esimStatus` is `GOT_RESOURCE` and `smdpStatus`
   * is `RELEASED` (created but never downloaded to a device).
   * @see https://docs.esimaccess.com/ (Cancel Profile)
   */
  async cancelEsim(esimTranNo: string): Promise<unknown> {
    return this.post('/esim/cancel', { esimTranNo });
  }

  /**
   * Permanently disable an already-installed/activated eSIM. No provider
   * refund — this is a "stop the bleeding" safety valve, e.g. when a
   * fulfillment arrives after we already refunded the customer.
   * @see https://docs.esimaccess.com/ (Revoke Profile)
   */
  async revokeEsim(esimTranNo: string): Promise<unknown> {
    return this.post('/esim/revoke', { esimTranNo });
  }

  /**
   * Register webhook URL with eSIM Access (ngrok HTTPS URL in local dev).
   * @see https://docs.esimaccess.com/#6ff716a7-5b8a-47e2-bcd2-250da94ac325
   */
  async saveWebhook(webhookUrl: string): Promise<{ webhook: string }> {
    return this.post('/webhook/save', { webhookUrl });
  }

  async queryWebhook(): Promise<{ webhook: string | null }> {
    const obj = await this.post<{ webhook?: string }>('/webhook/query', {});
    return { webhook: obj.webhook ?? null };
  }

  verifyWebhookSignature(rawBody: string, signature?: string): boolean {
    if (!this.webhookSecret) {
      this.logger.warn('ESIM_ACCESS_WEBHOOK_SECRET not set; skipping verify');
      return true;
    }
    if (!signature) {
      return false;
    }
    const hash = createHmac('sha256', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}
