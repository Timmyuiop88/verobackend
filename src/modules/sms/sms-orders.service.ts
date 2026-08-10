import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NumberRentalStatus,
  OrderStatus,
  OrderType,
  Prisma,
  SmsVerificationStatus,
  type NumberRental,
  type NumberRentalMessage,
  type Order,
  type SmsCountry,
  type SmsOneTimeOffer,
  type SmsRentalPlan,
  type SmsRentalSku,
  type SmsService,
  type SmsVerification,
  type User,
} from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SmsPoolService } from '../integrations/smspool/smspool.service';
import { WalletService } from '../wallet/wallet.service';
import { SmsCatalogService } from './sms-catalog.service';
import { SmsFulfillmentService } from './sms-fulfillment.service';
import {
  SMSPOOL_FULFILL_JOB_ATTEMPTS,
  SMSPOOL_FULFILL_JOB_BACKOFF_MS,
  SMSPOOL_FULFILL_JOB_NAME,
  SMSPOOL_FULFILL_QUEUE,
} from './sms.constants';

export type VerificationOrder = Order & {
  smsVerification: SmsVerification | null;
  smsOneTimeOffer:
    | (SmsOneTimeOffer & {
        service: SmsService;
        country: SmsCountry;
      })
    | null;
};

export type RentalOrderDetail = NumberRental & {
  order: Order;
  plan: SmsRentalPlan & { rentalSku: SmsRentalSku };
  messages?: NumberRentalMessage[];
};

const VERIFICATION_INCLUDE = {
  smsVerification: true,
  smsOneTimeOffer: {
    include: { service: true, country: true },
  },
} as const;

@Injectable()
export class SmsOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly catalog: SmsCatalogService,
    private readonly fulfillment: SmsFulfillmentService,
    private readonly smspool: SmsPoolService,
    @InjectQueue(SMSPOOL_FULFILL_QUEUE)
    private readonly fulfillQueue: Queue,
  ) {}

  async createVerification(
    user: User,
    offerId: string,
  ): Promise<VerificationOrder> {
    const offer = await this.catalog.getPurchasableOffer(offerId);

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        orderType: OrderType.SMS_ONE_TIME,
        smsOneTimeOfferId: offer.id,
        amount: offer.retailPrice,
        currency: offer.currency,
        status: OrderStatus.PAID,
      },
    });

    await this.prisma.smsVerification.create({
      data: {
        orderId: order.id,
        offerId: offer.id,
        status: SmsVerificationStatus.PENDING,
      },
    });

    try {
      await this.walletService.debit({
        userId: user.id,
        amount: offer.retailPrice,
        reference: `purchase_${order.id}`,
        metadata: {
          orderId: order.id,
          smsOneTimeOfferId: offer.id,
        },
      });
    } catch (error) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.FAILED,
          failureReason: 'wallet_debit_failed',
        },
      });
      throw error;
    }

    const fulfilling = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLING },
      include: VERIFICATION_INCLUDE,
    });

    await this.fulfillQueue.add(
      SMSPOOL_FULFILL_JOB_NAME,
      { orderId: order.id, kind: 'sms_one_time' },
      {
        jobId: order.id,
        attempts: SMSPOOL_FULFILL_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: SMSPOOL_FULFILL_JOB_BACKOFF_MS,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    return fulfilling;
  }

  async createRental(
    user: User,
    params: { planId: string; serviceExternalId?: number },
  ): Promise<RentalOrderDetail> {
    const plan = await this.catalog.getPurchasablePlan(params.planId);

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        orderType: OrderType.NUMBER_RENTAL,
        numberRentalPlanId: plan.id,
        amount: plan.retailPrice,
        currency: plan.currency,
        status: OrderStatus.PAID,
      },
    });

    const rental = await this.prisma.numberRental.create({
      data: {
        orderId: order.id,
        planId: plan.id,
        days: plan.days,
        serviceExternalId: params.serviceExternalId ?? null,
        status: NumberRentalStatus.PENDING,
      },
    });

    try {
      await this.walletService.debit({
        userId: user.id,
        amount: plan.retailPrice,
        reference: `purchase_${order.id}`,
        metadata: {
          orderId: order.id,
          numberRentalPlanId: plan.id,
          numberRentalId: rental.id,
        },
      });
    } catch (error) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.FAILED,
          failureReason: 'wallet_debit_failed',
        },
      });
      throw error;
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLING },
    });

    await this.fulfillQueue.add(
      SMSPOOL_FULFILL_JOB_NAME,
      { orderId: order.id, kind: 'number_rental' },
      {
        jobId: order.id,
        attempts: SMSPOOL_FULFILL_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: SMSPOOL_FULFILL_JOB_BACKOFF_MS,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    return this.getRentalForUser(user.id, rental.id);
  }

  async extendRental(
    user: User,
    rentalId: string,
    days: number,
  ): Promise<RentalOrderDetail> {
    if (!Number.isInteger(days) || days <= 0) {
      throw new BadRequestException('days must be a positive integer');
    }

    const rental = await this.prisma.numberRental.findUnique({
      where: { id: rentalId },
      include: {
        order: true,
        plan: { include: { rentalSku: { include: { plans: true } } } },
      },
    });
    if (!rental || rental.order.userId !== user.id) {
      throw new NotFoundException('Rental not found');
    }
    if (
      rental.status !== NumberRentalStatus.ACTIVE &&
      rental.status !== NumberRentalStatus.PENDING_ACTIVATION
    ) {
      throw new BadRequestException('Rental cannot be extended in this state');
    }
    if (!rental.rentalCode) {
      throw new BadRequestException('Rental is not yet issued by the provider');
    }
    if (!rental.plan.rentalSku.extendable) {
      throw new BadRequestException('This rental SKU is not extendable');
    }

    const extendPlan =
      rental.plan.rentalSku.plans.find(
        (p) => p.days === days && p.status === 'PUBLISHED',
      ) ?? null;
    const amount = extendPlan?.retailPrice ?? rental.plan.retailPrice;

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        orderType: OrderType.NUMBER_RENTAL_EXTEND,
        numberRentalPlanId: extendPlan?.id ?? rental.planId,
        targetNumberRentalId: rental.id,
        amount,
        currency: rental.plan.currency,
        status: OrderStatus.PAID,
      },
    });

    try {
      await this.walletService.debit({
        userId: user.id,
        amount,
        reference: `purchase_${order.id}`,
        metadata: {
          orderId: order.id,
          numberRentalId: rental.id,
          days,
        },
      });
    } catch (error) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.FAILED,
          failureReason: 'wallet_debit_failed',
        },
      });
      throw error;
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.FULFILLING },
    });

    await this.fulfillQueue.add(
      SMSPOOL_FULFILL_JOB_NAME,
      {
        orderId: order.id,
        kind: 'number_rental_extend',
        rentalId: rental.id,
        days,
      },
      {
        jobId: order.id,
        attempts: SMSPOOL_FULFILL_JOB_ATTEMPTS,
        backoff: {
          type: 'exponential',
          delay: SMSPOOL_FULFILL_JOB_BACKOFF_MS,
        },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    return this.getRentalForUser(user.id, rental.id);
  }

  async listVerifications(userId: string) {
    return this.prisma.order.findMany({
      where: { userId, orderType: OrderType.SMS_ONE_TIME },
      include: VERIFICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getVerification(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId, orderType: OrderType.SMS_ONE_TIME },
      include: VERIFICATION_INCLUDE,
    });
    if (!order) throw new NotFoundException('Verification order not found');
    return order;
  }

  async listRentals(userId: string) {
    return this.prisma.numberRental.findMany({
      where: { order: { userId } },
      include: {
        order: true,
        plan: { include: { rentalSku: true } },
        messages: { orderBy: { receivedAt: 'desc' }, take: 20 },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getRentalForUser(userId: string, rentalId: string) {
    const rental = await this.prisma.numberRental.findFirst({
      where: { id: rentalId, order: { userId } },
      include: {
        order: true,
        plan: { include: { rentalSku: true } },
        messages: { orderBy: { receivedAt: 'desc' }, take: 100 },
      },
    });
    if (!rental) throw new NotFoundException('Rental not found');
    return rental;
  }

  async requestCustomerRefund(userId: string, rentalId: string) {
    const rental = await this.getRentalForUser(userId, rentalId);
    if (!rental.rentalCode) {
      throw new BadRequestException('Rental is not yet issued');
    }

    const info = await this.smspool.getRentalInfo(rental.rentalCode);
    if (!info.refund) {
      throw new ForbiddenException(
        'SMSPool does not allow a refund for this rental',
      );
    }

    await this.smspool.refundRental(rental.rentalCode);
    await this.fulfillment.failAndRefund({
      orderId: rental.orderId,
      reason: 'customer_rental_refund',
      rentalStatus: NumberRentalStatus.REFUNDED,
    });

    return this.getRentalForUser(userId, rentalId);
  }
}
