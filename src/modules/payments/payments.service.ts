import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentIntentStatus,
  PaymentProvider,
  Prisma,
  type User,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Env } from '../../config/env.schema';
import { OxapayService } from '../integrations/oxapay/oxapay.service';
import { PaystackService } from '../integrations/paystack/paystack.service';
import type { InitializePaymentDto } from './dto/initialize-payment.dto';
import type { PaymentInitializeResponseDto } from './dto/initialize-payment.dto';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystack: PaystackService,
    private readonly oxapay: OxapayService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async initializePaystack(
    user: User,
    dto: InitializePaymentDto,
  ): Promise<PaymentInitializeResponseDto> {
    const reference = `ps_${randomUUID().replace(/-/g, '')}`;
    const amount = new Prisma.Decimal(dto.amount);

    const intent = await this.prisma.paymentIntent.create({
      data: {
        userId: user.id,
        provider: PaymentProvider.PAYSTACK,
        externalId: reference,
        amount,
        currency: 'USD',
        status: PaymentIntentStatus.PENDING,
        metadata: { returnUrl: dto.returnUrl },
      },
    });

    const appUrl = this.config.get('APP_URL', { infer: true });
    try {
      const result = await this.paystack.initializeTransaction({
        email: user.email,
        amountUsd: dto.amount,
        reference,
        callbackUrl: dto.returnUrl ?? `${appUrl}/payments/callback`,
      });

      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: {
          metadata: {
            returnUrl: dto.returnUrl,
            chargeCurrency: result.chargeCurrency,
            chargeAmount: result.chargeAmount,
          },
        },
      });

      return {
        paymentIntentId: intent.id,
        provider: PaymentProvider.PAYSTACK,
        reference: result.reference,
        paymentUrl: result.authorizationUrl,
        amount: amount.toString(),
        currency: 'USD',
      };
    } catch (error) {
      await this.prisma.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED },
      });
      throw error;
    }
  }

  async initializeOxapay(
    user: User,
    dto: InitializePaymentDto,
  ): Promise<PaymentInitializeResponseDto> {
    const orderId = `ox_${randomUUID().replace(/-/g, '')}`;
    const amount = new Prisma.Decimal(dto.amount);
    const appUrl = this.config.get('APP_URL', { infer: true });

    const intent = await this.prisma.paymentIntent.create({
      data: {
        userId: user.id,
        provider: PaymentProvider.OXAPAY,
        externalId: orderId,
        amount,
        currency: 'USD',
        status: PaymentIntentStatus.PENDING,
        metadata: { returnUrl: dto.returnUrl },
      },
    });

    const result = await this.oxapay.createInvoice({
      amountUsd: dto.amount,
      orderId,
      callbackUrl: `${appUrl}/api/v1/webhooks/oxapay`,
      returnUrl: dto.returnUrl,
    });

    await this.prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        metadata: {
          returnUrl: dto.returnUrl,
          trackId: result.trackId,
        },
      },
    });

    return {
      paymentIntentId: intent.id,
      provider: PaymentProvider.OXAPAY,
      reference: orderId,
      paymentUrl: result.paymentUrl,
      amount: amount.toString(),
      currency: 'USD',
    };
  }
}
