import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  NumberRentalStatus,
  OrderStatus,
  SmsVerificationStatus,
} from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SmsPoolService } from '../../integrations/smspool/smspool.service';
import { SmsFulfillmentService } from '../sms-fulfillment.service';
import {
  SMSPOOL_MAX_POLL_ATTEMPTS,
  SMSPOOL_POLL_JOB_NAME,
  SMSPOOL_POLL_QUEUE,
  smsPoolPollDelayMs,
} from '../sms.constants';
import { extractSmsCode } from '../sms.util';

type PollJobData = {
  orderId: string;
  kind: 'sms_one_time' | 'number_rental';
  attempt: number;
};

@Processor(SMSPOOL_POLL_QUEUE)
export class SmsPollProcessor extends WorkerHost {
  private readonly logger = new Logger(SmsPollProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly smspool: SmsPoolService,
    private readonly fulfillment: SmsFulfillmentService,
    @InjectQueue(SMSPOOL_POLL_QUEUE) private readonly pollQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<PollJobData>): Promise<void> {
    const { orderId, kind, attempt } = job.data;
    if (kind === 'sms_one_time') {
      await this.pollOneTime(orderId, attempt);
      return;
    }
    await this.pollRental(orderId, attempt);
  }

  private async pollOneTime(orderId: string, attempt: number): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { smsVerification: true },
    });
    if (!order?.smsVerification) return;
    if (
      order.status === OrderStatus.COMPLETED ||
      order.status === OrderStatus.REFUNDED ||
      order.smsVerification.status === SmsVerificationStatus.COMPLETED
    ) {
      return;
    }

    const providerOrderId = order.smsVerification.providerOrderId;
    if (!providerOrderId) {
      return;
    }

    const active = await this.smspool.listActiveOrders();
    const match = active.find((row) => row.order_code === providerOrderId);

    if (match?.full_code || (match?.code && match.code !== '0')) {
      const fullSms = match.full_code || String(match.code);
      await this.fulfillment.completeVerificationFromSms({
        providerOrderId,
        fullSms,
        smsCode: extractSmsCode(fullSms) ?? String(match.code),
      });
      return;
    }

    const expired =
      (order.smsVerification.expiresAt &&
        order.smsVerification.expiresAt.getTime() <= Date.now()) ||
      (match?.time_left !== undefined && match.time_left <= 0);

    if (expired || attempt >= SMSPOOL_MAX_POLL_ATTEMPTS) {
      try {
        await this.smspool.cancelSms(providerOrderId);
      } catch (error) {
        this.logger.warn(
          `Cancel SMS ${providerOrderId} failed: ${(error as Error).message}`,
        );
      }
      await this.fulfillment.failAndRefund({
        orderId,
        reason: expired ? 'sms_timeout' : 'sms_poll_exhausted',
        verificationStatus: SmsVerificationStatus.EXPIRED,
      });
      return;
    }

    const next = attempt + 1;
    await this.pollQueue.add(
      SMSPOOL_POLL_JOB_NAME,
      { orderId, kind: 'sms_one_time', attempt: next },
      {
        jobId: `${orderId}_poll_${next}`,
        delay: smsPoolPollDelayMs(next),
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );
  }

  private async pollRental(orderId: string, attempt: number): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { numberRental: true },
    });
    if (!order?.numberRental) return;
    const rental = order.numberRental;
    if (!rental.rentalCode) return;
    const rentalCode = rental.rentalCode;
    if (
      rental.status === NumberRentalStatus.REFUNDED ||
      rental.status === NumberRentalStatus.FAILED
    ) {
      return;
    }

    try {
      const status = await this.smspool.getRentalStatus(rentalCode);
      const available = status.status?.available === 1;
      const phone = status.status?.phonenumber
        ? String(status.status.phonenumber)
        : null;
      const expiry = status.status?.expiry
        ? new Date(status.status.expiry * 1000)
        : null;

      if (phone || expiry) {
        await this.prisma.numberRental.update({
          where: { id: rental.id },
          data: {
            ...(phone ? { phoneNumber: phone } : {}),
            ...(expiry ? { expiresAt: expiry } : {}),
            autoExtend: status.status?.auto_extend === 1,
          },
        });
      }

      if (
        available &&
        rental.status === NumberRentalStatus.PENDING_ACTIVATION
      ) {
        await this.fulfillment.activateRental(rental.id);
      }

      const messages = await this.smspool.getRentalMessages(rentalCode);
      for (const message of messages.messages ?? []) {
        if (!message.message) continue;
        await this.fulfillment.appendRentalMessage({
          rentalCode,
          fullSms: message.message,
          sender: message.sender ?? null,
          providerMessageId: message.ID ? String(message.ID) : null,
          receivedAt: message.timestamp
            ? new Date(message.timestamp)
            : undefined,
        });
      }
    } catch (error) {
      this.logger.warn(
        `Rental poll ${rentalCode} failed: ${(error as Error).message}`,
      );
    }

    // Keep polling while pending activation; stop once active (webhooks own SMS).
    if (
      rental.status === NumberRentalStatus.PENDING_ACTIVATION &&
      attempt < SMSPOOL_MAX_POLL_ATTEMPTS
    ) {
      const next = attempt + 1;
      await this.pollQueue.add(
        SMSPOOL_POLL_JOB_NAME,
        { orderId, kind: 'number_rental', attempt: next },
        {
          jobId: `${orderId}_poll_${next}`,
          delay: smsPoolPollDelayMs(next),
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
      return;
    }

    if (
      rental.status === NumberRentalStatus.PENDING_ACTIVATION &&
      attempt >= SMSPOOL_MAX_POLL_ATTEMPTS
    ) {
      await this.fulfillment.failAndRefund({
        orderId,
        reason: 'rental_activation_timeout',
        rentalStatus: NumberRentalStatus.FAILED,
      });
    }
  }
}
