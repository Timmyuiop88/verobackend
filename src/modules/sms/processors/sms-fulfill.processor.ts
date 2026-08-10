import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  NumberRentalStatus,
  OrderStatus,
  Prisma,
  SmsVerificationStatus,
} from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { opsAlert } from '../../../common/observability/ops-alert';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Env } from '../../../config/env.schema';
import { SmsPoolBusinessError } from '../../integrations/smspool/smspool.errors';
import { SmsPoolService } from '../../integrations/smspool/smspool.service';
import { SmsFulfillmentService } from '../sms-fulfillment.service';
import {
  SMSPOOL_FULFILL_QUEUE,
  SMSPOOL_POLL_JOB_NAME,
  SMSPOOL_POLL_QUEUE,
  smsPoolPollDelayMs,
} from '../sms.constants';

type FulfillJobData = {
  orderId: string;
  kind: 'sms_one_time' | 'number_rental' | 'number_rental_extend';
  rentalId?: string;
  days?: number;
};

@Processor(SMSPOOL_FULFILL_QUEUE)
export class SmsFulfillProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsFulfillProcessor.name);
  private readonly smsTimeoutSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly smspool: SmsPoolService,
    private readonly fulfillment: SmsFulfillmentService,
    config: ConfigService<Env, true>,
    @InjectQueue(SMSPOOL_POLL_QUEUE) private readonly pollQueue: Queue,
  ) {
    super();
    this.smsTimeoutSeconds = config.get('SMSPOOL_SMS_TIMEOUT_SECONDS', {
      infer: true,
    });
  }

  async process(job: Job<FulfillJobData>): Promise<void> {
    const { orderId, kind } = job.data;
    if (kind === 'sms_one_time') {
      await this.fulfillOneTime(orderId, job);
      return;
    }
    if (kind === 'number_rental') {
      await this.fulfillRental(orderId, job);
      return;
    }
    await this.fulfillExtend(orderId, job);
  }

  private async fulfillOneTime(
    orderId: string,
    job: Job<FulfillJobData>,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        smsVerification: true,
        smsOneTimeOffer: { include: { service: true, country: true } },
      },
    });
    if (!order?.smsVerification || !order.smsOneTimeOffer) {
      this.logger.warn(`SMS one-time order ${orderId} missing relations`);
      return;
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      return;
    }

    if (order.smsVerification.providerOrderId) {
      await this.enqueuePoll(orderId, 'sms_one_time');
      return;
    }

    try {
      await this.guardBalance(order.smsOneTimeOffer.providerCost, orderId);
      const result = await this.smspool.purchaseSms({
        country: order.smsOneTimeOffer.country.externalId,
        service: order.smsOneTimeOffer.service.externalId,
        pool: order.smsOneTimeOffer.pool || undefined,
        maxPrice: Number(order.smsOneTimeOffer.providerCost) * 1.25,
      });

      const providerOrderId = result.order_id;
      if (!providerOrderId) {
        throw new SmsPoolBusinessError(
          502,
          'missing_order_id',
          'SMSPool purchase succeeded without order_id',
          result,
        );
      }

      const expiresAt = result.expiration
        ? new Date(result.expiration * 1000)
        : new Date(Date.now() + this.smsTimeoutSeconds * 1000);

      await this.fulfillment.markVerificationAwaiting({
        orderId,
        providerOrderId,
        phoneNumber: result.phonenumber
          ? String(result.phonenumber)
          : result.number
            ? String(result.number)
            : null,
        countryCode: result.cc ? String(result.cc) : null,
        providerCost: result.cost
          ? new Prisma.Decimal(result.cost)
          : order.smsOneTimeOffer.providerCost,
        expiresAt,
        rawResponse: result as unknown as Prisma.InputJsonValue,
      });

      await this.enqueuePoll(orderId, 'sms_one_time');
    } catch (error) {
      await this.handleProviderError(orderId, job, error, {
        verificationStatus: SmsVerificationStatus.FAILED,
      });
    }
  }

  private async fulfillRental(
    orderId: string,
    job: Job<FulfillJobData>,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        numberRental: true,
        numberRentalPlan: { include: { rentalSku: true } },
      },
    });
    if (!order?.numberRental || !order.numberRentalPlan) {
      this.logger.warn(`Rental order ${orderId} missing relations`);
      return;
    }
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED
    ) {
      return;
    }

    if (order.numberRental.rentalCode) {
      await this.enqueuePoll(orderId, 'number_rental');
      return;
    }

    try {
      await this.guardBalance(order.numberRentalPlan.providerCost, orderId);
      const result = await this.smspool.purchaseRental({
        id: order.numberRentalPlan.rentalSku.externalId,
        days: order.numberRentalPlan.days,
        serviceId: order.numberRental.serviceExternalId ?? undefined,
      });

      const rentalCode = result.rental_code;
      if (!rentalCode) {
        throw new SmsPoolBusinessError(
          502,
          'missing_rental_code',
          'SMSPool rental purchase missing rental_code',
          result,
        );
      }

      const phone = result.phonenumber ? String(result.phonenumber) : null;
      const pendingActivation = !phone || phone === '0' || phone === '';

      await this.fulfillment.markRentalOrdered({
        orderId,
        rentalCode,
        phoneNumber: phone,
        expiresAt: result.expiry ? new Date(result.expiry * 1000) : null,
        providerCost: order.numberRentalPlan.providerCost,
        rawResponse: result as unknown as Prisma.InputJsonValue,
        pendingActivation,
      });

      await this.enqueuePoll(orderId, 'number_rental');
    } catch (error) {
      await this.handleProviderError(orderId, job, error, {
        rentalStatus: NumberRentalStatus.FAILED,
      });
    }
  }

  private async fulfillExtend(
    orderId: string,
    job: Job<FulfillJobData>,
  ): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { targetNumberRental: true },
    });
    if (!order?.targetNumberRental?.rentalCode) {
      await this.fulfillment.failAndRefund({
        orderId,
        reason: 'missing_rental_for_extend',
      });
      return;
    }

    const days = job.data.days ?? order.targetNumberRental.days;
    try {
      const result = await this.smspool.extendRental({
        rentalCode: order.targetNumberRental.rentalCode,
        days,
      });
      const expiresAt = result.expiration_date
        ? new Date(result.expiration_date * 1000)
        : null;
      await this.prisma.numberRental.update({
        where: { id: order.targetNumberRental.id },
        data: {
          ...(expiresAt ? { expiresAt } : {}),
          days: order.targetNumberRental.days + days,
        },
      });
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    } catch (error) {
      await this.handleProviderError(orderId, job, error, {});
    }
  }

  private async enqueuePoll(
    orderId: string,
    kind: 'sms_one_time' | 'number_rental',
  ): Promise<void> {
    await this.pollQueue.add(
      SMSPOOL_POLL_JOB_NAME,
      { orderId, kind, attempt: 1 },
      {
        jobId: `${orderId}_poll_1`,
        delay: smsPoolPollDelayMs(1),
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }

  private async guardBalance(
    cost: Prisma.Decimal,
    orderId: string,
  ): Promise<void> {
    try {
      const balance = await this.smspool.getBalance();
      const value = Number(balance.balance);
      if (!Number.isNaN(value) && value < Number(cost)) {
        opsAlert('smspool_insufficient_balance', {
          orderId,
          balance: value,
          needed: cost.toString(),
        });
        throw new SmsPoolBusinessError(
          402,
          'insufficient_balance',
          `SMSPool balance ${value} is below cost ${cost}`,
        );
      }
      if (
        !Number.isNaN(value) &&
        value < this.smspool.minimumBalanceAlertThreshold
      ) {
        opsAlert('smspool_low_balance', { balance: value, orderId });
      }
    } catch (error) {
      if (error instanceof SmsPoolBusinessError) throw error;
      this.logger.warn(
        `SMSPool balance preflight failed: ${(error as Error).message}`,
      );
    }
  }

  private async handleProviderError(
    orderId: string,
    job: Job<FulfillJobData>,
    error: unknown,
    statuses: {
      verificationStatus?: SmsVerificationStatus;
      rentalStatus?: NumberRentalStatus;
    },
  ): Promise<void> {
    if (error instanceof SmsPoolBusinessError) {
      await this.fulfillment.failAndRefund({
        orderId,
        reason: `provider_rejected:${error.message}`,
        ...statuses,
      });
      return;
    }

    const maxAttempts = job.opts.attempts ?? 1;
    const isLastAttempt = job.attemptsMade + 1 >= maxAttempts;
    this.logger.error(
      `SMSPool fulfill failed for ${orderId} (attempt ${job.attemptsMade + 1}/${maxAttempts})`,
      error as Error,
    );
    if (!isLastAttempt) {
      throw error;
    }
    await this.fulfillment.failAndRefund({
      orderId,
      reason: `provider_unavailable:${(error as Error).message}`,
      ...statuses,
    });
  }
}
