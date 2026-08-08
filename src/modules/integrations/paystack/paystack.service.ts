import { createHmac } from 'crypto';
import { HttpService } from '@nestjs/axios';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { Env } from '../../../config/env.schema';

export type PaystackInitializeResult = {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
  /** Amount charged on Paystack in major units (e.g. NGN naira) */
  chargeAmount: number;
  chargeCurrency: string;
};

type PaystackErrorBody = {
  status?: boolean;
  message?: string;
  meta?: { nextStep?: string };
  code?: string;
};

@Injectable()
export class PaystackService {
  private readonly logger = new Logger(PaystackService.name);
  private readonly secretKey: string;
  private readonly webhookSecret: string;
  private readonly currency: string;
  private readonly usdToNgnRate: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<Env, true>,
  ) {
    this.secretKey = this.config.get('PAYSTACK_SECRET_KEY', { infer: true });
    this.webhookSecret = this.config.get('PAYSTACK_WEBHOOK_SECRET', {
      infer: true,
    });
    this.currency = this.config
      .get('PAYSTACK_CURRENCY', { infer: true })
      .toUpperCase();
    this.usdToNgnRate = this.config.get('PAYSTACK_USD_NGN_RATE', {
      infer: true,
    });
  }

  /**
   * Wallet deposits are USD. Paystack NG merchants usually only accept NGN.
   * Convert USD → charge currency, send amount in subunit (kobo/cents).
   */
  private toChargeAmount(amountUsd: number): {
    subunit: number;
    major: number;
    currency: string;
  } {
    if (this.currency === 'USD') {
      return {
        subunit: Math.round(amountUsd * 100),
        major: amountUsd,
        currency: 'USD',
      };
    }

    // Default path: NGN (and other non-USD) — convert from USD using rate
    const major = Number((amountUsd * this.usdToNgnRate).toFixed(2));
    return {
      subunit: Math.round(major * 100),
      major,
      currency: this.currency,
    };
  }

  async initializeTransaction(params: {
    email: string;
    amountUsd: number;
    reference: string;
    callbackUrl?: string;
  }): Promise<PaystackInitializeResult> {
    const charge = this.toChargeAmount(params.amountUsd);

    try {
      const { data } = await firstValueFrom(
        this.http.post<{
          status: boolean;
          message: string;
          data: {
            authorization_url: string;
            access_code: string;
            reference: string;
          };
        }>(
          'https://api.paystack.co/transaction/initialize',
          {
            email: params.email,
            amount: charge.subunit,
            currency: charge.currency,
            reference: params.reference,
            callback_url: params.callbackUrl,
            metadata: {
              wallet_currency: 'USD',
              wallet_amount_usd: params.amountUsd,
              charge_currency: charge.currency,
              charge_amount: charge.major,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      if (!data.status) {
        throw new BadRequestException(data.message || 'Paystack init failed');
      }

      return {
        authorizationUrl: data.data.authorization_url,
        accessCode: data.data.access_code,
        reference: data.data.reference,
        chargeAmount: charge.major,
        chargeCurrency: charge.currency,
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      const axiosError = error as AxiosError<PaystackErrorBody>;
      const paystackMessage =
        axiosError.response?.data?.message ??
        (error instanceof Error ? error.message : 'Paystack init failed');
      const nextStep = axiosError.response?.data?.meta?.nextStep;

      this.logger.error(
        `Paystack initialize failed: ${paystackMessage}${nextStep ? ` (${nextStep})` : ''}`,
      );

      throw new BadRequestException(
        nextStep ? `${paystackMessage}. ${nextStep}` : paystackMessage,
      );
    }
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    const hash = createHmac('sha512', this.webhookSecret)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}
