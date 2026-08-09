import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  DomainEvent,
  type OrderCompletedPayload,
  type OrderFailedPayload,
  type TopUpCompletedPayload,
  type WalletCreditedPayload,
} from '../../../common/events/domain-events';
import { humanizeFailureReason } from '../../../common/events/humanize-failure-reason';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmailService } from '../../integrations/email/email.service';

/**
 * Turns domain events into transactional emails. Independent of
 * NotificationsEventListener — email failures/EMAIL_ENABLED=false never
 * affect in-app notifications.
 */
@Injectable()
export class EmailEventListener {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  private async emailFor(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  @OnEvent(DomainEvent.WalletCredited)
  async onWalletCredited(payload: WalletCreditedPayload): Promise<void> {
    const to = await this.emailFor(payload.userId);
    if (!to) return;
    if (payload.direction === 'debit') {
      await this.emailService.sendWalletDebited({
        to,
        amount: payload.amount,
      });
      return;
    }
    await this.emailService.sendWalletCredited({
      to,
      amount: payload.amount,
      currency: payload.currency,
      kind: payload.type as 'DEPOSIT' | 'REFUND' | 'ADJUSTMENT',
    });
  }

  @OnEvent(DomainEvent.OrderCompleted)
  async onOrderCompleted(payload: OrderCompletedPayload): Promise<void> {
    const to = await this.emailFor(payload.userId);
    if (!to) return;
    await this.emailService.sendOrderCompleted({
      to,
      amount: payload.amount,
      productName: payload.productName,
      iccid: payload.iccid,
    });
  }

  @OnEvent(DomainEvent.OrderFailed)
  async onOrderFailed(payload: OrderFailedPayload): Promise<void> {
    const to = await this.emailFor(payload.userId);
    if (!to) return;
    await this.emailService.sendOrderFailed({
      to,
      amount: payload.amount,
      reasonText: humanizeFailureReason(payload.reason),
      isTopUp: payload.orderType === 'TOPUP',
    });
  }

  @OnEvent(DomainEvent.TopUpCompleted)
  async onTopUpCompleted(payload: TopUpCompletedPayload): Promise<void> {
    const to = await this.emailFor(payload.userId);
    if (!to) return;
    await this.emailService.sendTopUpCompleted({
      to,
      amount: payload.amount,
    });
  }
}
