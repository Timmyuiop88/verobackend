import { createHmac, timingSafeEqual } from 'crypto';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import type { Env } from '../../../config/env.schema';

export type OxaPayInvoiceResult = {
  trackId: string;
  paymentUrl: string;
};

@Injectable()
export class OxapayService {
  private readonly logger = new Logger(OxapayService.name);
  private readonly apiKey: string;
  private readonly webhookSecret: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.apiKey = this.config.get('OXAPAY_MERCHANT_API_KEY', { infer: true });
    this.webhookSecret = this.config.get('OXAPAY_WEBHOOK_SECRET', {
      infer: true,
    });
  }

  async createInvoice(params: {
    amountUsd: number;
    orderId: string;
    callbackUrl: string;
    returnUrl?: string;
    description?: string;
  }): Promise<OxaPayInvoiceResult> {
    try {
      const { data } = await firstValueFrom(
        this.http.post<{
          data?: { track_id?: string; payment_url?: string };
          track_id?: string;
          payment_url?: string;
          message?: string;
          error?: { message?: string };
        }>(
          'https://api.oxapay.com/v1/payment/invoice',
          {
            amount: params.amountUsd,
            currency: 'USD',
            lifetime: 60,
            callback_url: params.callbackUrl,
            return_url: params.returnUrl,
            order_id: params.orderId,
            description: params.description ?? 'TradeVero wallet deposit',
          },
          {
            headers: {
              merchant_api_key: this.apiKey,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      const trackId = data.data?.track_id ?? data.track_id;
      const paymentUrl = data.data?.payment_url ?? data.payment_url;

      if (!trackId || !paymentUrl) {
        throw new BadRequestException(
          data.error?.message || data.message || 'OxaPay invoice failed',
        );
      }

      return { trackId, paymentUrl };
    } catch (error) {
      this.logger.error('OxaPay invoice failed', error as Error);
      throw new BadRequestException('Unable to initialize OxaPay payment');
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const hash = createHmac('sha512', this.webhookSecret)
      .update(rawBody)
      .digest('hex');

    try {
      return timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
