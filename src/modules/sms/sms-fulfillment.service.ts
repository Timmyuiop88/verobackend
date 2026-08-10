import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  NumberRentalStatus,
  OrderStatus,
  OrderType,
  Prisma,
  SmsVerificationStatus,
  type NumberRental,
  type SmsVerification,
} from '@prisma/client';
import {
  DomainEvent,
  type RentalReadyPayload,
  type RentalSmsReceivedPayload,
  type SmsCodeReceivedPayload,
} from '../../common/events/domain-events';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { extractSmsCode } from './sms.util';

@Injectable()
export class SmsFulfillmentService {
  private readonly logger = new Logger(SmsFulfillmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fulfillment: FulfillmentService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async failAndRefund(params: {
    orderId: string;
    reason: string;
    verificationStatus?: SmsVerificationStatus;
    rentalStatus?: NumberRentalStatus;
  }): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: params.orderId },
    });
    if (!order) return;

    if (params.verificationStatus) {
      await this.prisma.smsVerification.updateMany({
        where: { orderId: params.orderId },
        data: { status: params.verificationStatus },
      });
    }
    if (params.rentalStatus) {
      await this.prisma.numberRental.updateMany({
        where: { orderId: params.orderId },
        data: { status: params.rentalStatus },
      });
    }

    await this.fulfillment.refundAndFail(params.orderId, params.reason);
    // Do not emit OrderFailed here — `refundAndFail` already does, and a
    // second emit duplicates the "… failed — refunded" in-app notification.
  }

  async markVerificationAwaiting(params: {
    orderId: string;
    providerOrderId: string;
    phoneNumber?: string | null;
    countryCode?: string | null;
    providerCost?: Prisma.Decimal | null;
    expiresAt?: Date | null;
    rawResponse?: Prisma.InputJsonValue;
  }): Promise<SmsVerification> {
    return this.prisma.smsVerification.update({
      where: { orderId: params.orderId },
      data: {
        providerOrderId: params.providerOrderId,
        phoneNumber: params.phoneNumber ?? null,
        countryCode: params.countryCode ?? null,
        providerCost: params.providerCost ?? null,
        expiresAt: params.expiresAt ?? null,
        status: SmsVerificationStatus.AWAITING_SMS,
        rawResponse: params.rawResponse,
      },
    });
  }

  async completeVerificationFromSms(params: {
    providerOrderId: string;
    fullSms: string;
    smsCode?: string | null;
  }): Promise<SmsVerification | null> {
    const verification = await this.prisma.smsVerification.findUnique({
      where: { providerOrderId: params.providerOrderId },
      include: { order: true },
    });
    if (!verification) {
      this.logger.warn(
        `No verification for SMSPool order ${params.providerOrderId}`,
      );
      return null;
    }
    if (
      verification.status === SmsVerificationStatus.COMPLETED ||
      verification.status === SmsVerificationStatus.REFUNDED
    ) {
      return verification;
    }

    const code = params.smsCode ?? extractSmsCode(params.fullSms);
    const updated = await this.prisma.smsVerification.update({
      where: { id: verification.id },
      data: {
        fullSms: params.fullSms,
        smsCode: code,
        status: SmsVerificationStatus.COMPLETED,
      },
    });

    if (verification.order.status !== OrderStatus.COMPLETED) {
      await this.prisma.order.update({
        where: { id: verification.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    }

    this.eventEmitter.emit(DomainEvent.SmsCodeReceived, {
      orderId: verification.orderId,
      userId: verification.order.userId,
      phoneNumber: updated.phoneNumber,
      smsCode: code,
    } satisfies SmsCodeReceivedPayload);

    return updated;
  }

  async markRentalOrdered(params: {
    orderId: string;
    rentalCode: string;
    phoneNumber?: string | null;
    expiresAt?: Date | null;
    providerCost?: Prisma.Decimal | null;
    rawResponse?: Prisma.InputJsonValue;
    pendingActivation: boolean;
  }): Promise<NumberRental> {
    const status = params.pendingActivation
      ? NumberRentalStatus.PENDING_ACTIVATION
      : NumberRentalStatus.ACTIVE;

    const rental = await this.prisma.numberRental.update({
      where: { orderId: params.orderId },
      data: {
        rentalCode: params.rentalCode,
        phoneNumber: params.phoneNumber
          ? String(params.phoneNumber)
          : null,
        expiresAt: params.expiresAt ?? null,
        providerCost: params.providerCost ?? null,
        status,
        rawResponse: params.rawResponse,
      },
      include: { order: true },
    });

    if (!params.pendingActivation) {
      await this.prisma.order.update({
        where: { id: params.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
      this.eventEmitter.emit(DomainEvent.RentalReady, {
        orderId: rental.orderId,
        userId: rental.order.userId,
        rentalId: rental.id,
        phoneNumber: rental.phoneNumber,
        expiresAt: rental.expiresAt?.toISOString() ?? null,
      } satisfies RentalReadyPayload);
    }

    return rental;
  }

  async activateRental(rentalId: string): Promise<NumberRental | null> {
    const rental = await this.prisma.numberRental.findUnique({
      where: { id: rentalId },
      include: { order: true },
    });
    if (!rental) return null;
    if (rental.status === NumberRentalStatus.ACTIVE) return rental;

    const updated = await this.prisma.numberRental.update({
      where: { id: rentalId },
      data: { status: NumberRentalStatus.ACTIVE },
      include: { order: true },
    });

    if (rental.order.status !== OrderStatus.COMPLETED) {
      await this.prisma.order.update({
        where: { id: rental.orderId },
        data: { status: OrderStatus.COMPLETED },
      });
    }

    this.eventEmitter.emit(DomainEvent.RentalReady, {
      orderId: updated.orderId,
      userId: updated.order.userId,
      rentalId: updated.id,
      phoneNumber: updated.phoneNumber,
      expiresAt: updated.expiresAt?.toISOString() ?? null,
    } satisfies RentalReadyPayload);

    return updated;
  }

  async appendRentalMessage(params: {
    rentalCode: string;
    fullSms: string;
    sender?: string | null;
    providerMessageId?: string | null;
    receivedAt?: Date;
  }) {
    const rental = await this.prisma.numberRental.findUnique({
      where: { rentalCode: params.rentalCode },
      include: { order: true },
    });
    if (!rental) {
      this.logger.warn(`No rental for code ${params.rentalCode}`);
      return null;
    }

    const code = extractSmsCode(params.fullSms);
    const providerMessageId =
      params.providerMessageId ??
      `${params.rentalCode}:${params.receivedAt?.toISOString() ?? Date.now()}:${params.fullSms.slice(0, 32)}`;

    try {
      const message = await this.prisma.numberRentalMessage.create({
        data: {
          numberRentalId: rental.id,
          providerMessageId,
          sender: params.sender ?? null,
          fullSms: params.fullSms,
          smsCode: code,
          receivedAt: params.receivedAt ?? new Date(),
        },
      });

      this.eventEmitter.emit(DomainEvent.RentalSmsReceived, {
        orderId: rental.orderId,
        userId: rental.order.userId,
        rentalId: rental.id,
        phoneNumber: rental.phoneNumber,
        fullSms: params.fullSms,
        smsCode: code,
      } satisfies RentalSmsReceivedPayload);

      return message;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      throw error;
    }
  }

  async applyAutoExtendWebhook(params: {
    rentalCode: string;
    success: boolean;
  }): Promise<void> {
    await this.prisma.numberRental.updateMany({
      where: { rentalCode: params.rentalCode },
      data: { autoExtend: params.success },
    });
  }

  isSmsOrderType(orderType: OrderType): boolean {
    return (
      orderType === OrderType.SMS_ONE_TIME ||
      orderType === OrderType.NUMBER_RENTAL ||
      orderType === OrderType.NUMBER_RENTAL_EXTEND
    );
  }
}
