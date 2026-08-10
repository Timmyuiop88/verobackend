import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import type { Env } from '../../../config/env.schema';
import { amountRow, renderEmailLayout } from './email-templates';

function formatUsd(amount: string | number): string {
  const value = Number(amount);
  if (Number.isNaN(value)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
}

/**
 * Plain SMTP via nodemailer — deliberately provider-agnostic. Point
 * SMTP_HOST/PORT/USER/PASS at Resend's SMTP relay, Gmail, SES, Mailgun,
 * Postmark, whatever — no code changes needed to switch providers. Soft-fails
 * everywhere (logs, never throws) since email is a side effect of business
 * events and must never break the flow that triggered it.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter | null = null;
  private enabled = false;
  private fromHeader = '';

  constructor(private readonly config: ConfigService<Env, true>) {}

  onModuleInit(): void {
    const enabled = this.config.get('EMAIL_ENABLED', { infer: true });
    const host = this.config.get('SMTP_HOST', { infer: true });
    const fromEmail = this.config.get('SMTP_FROM_EMAIL', { infer: true });
    const fromName = this.config.get('SMTP_FROM_NAME', { infer: true });
    this.fromHeader = `"${fromName}" <${fromEmail}>`;

    if (!enabled) {
      this.logger.log('Email sending disabled (EMAIL_ENABLED=false)');
      return;
    }
    if (!host) {
      this.logger.warn(
        'EMAIL_ENABLED=true but SMTP_HOST is empty — emails will be skipped',
      );
      return;
    }

    const user = this.config.get('SMTP_USER', { infer: true });
    const pass = this.config.get('SMTP_PASS', { infer: true });

    this.transporter = createTransport({
      host,
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      auth: user ? { user, pass } : undefined,
    });
    this.enabled = true;
    this.logger.log(`Email sending enabled via SMTP host ${host}`);
  }

  async send(params: SendEmailParams): Promise<void> {
    if (!this.enabled || !this.transporter) {
      this.logger.debug(
        `Skipping email to ${params.to} (email disabled): ${params.subject}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from: this.fromHeader,
        to: params.to,
        subject: params.subject,
        html: params.html,
      });
    } catch (error) {
      // Never let an email provider outage break the business flow that
      // triggered it — log loudly so ops can investigate, and move on.
      this.logger.error(
        `Failed to send email to ${params.to}: ${(error as Error).message}`,
      );
    }
  }

  async sendWalletCredited(params: {
    to: string;
    amount: string;
    currency: string;
    kind: 'DEPOSIT' | 'REFUND' | 'ADJUSTMENT';
    balanceAfter?: string;
  }): Promise<void> {
    const label =
      params.kind === 'DEPOSIT'
        ? 'Deposit successful'
        : params.kind === 'REFUND'
          ? 'Refund received'
          : 'Wallet adjusted';
    const html = renderEmailLayout({
      heading: label,
      bodyHtml: [
        `<p>Your TradeVero wallet has been credited.</p>`,
        amountRow('Amount credited', `+${formatUsd(params.amount)}`),
        `<p style="color:#6b7280;font-size:13px;">You can view this in your Transactions tab in the app.</p>`,
      ].join(''),
    });
    await this.send({ to: params.to, subject: label, html });
  }

  async sendWalletDebited(params: {
    to: string;
    amount: string;
  }): Promise<void> {
    const html = renderEmailLayout({
      heading: 'Wallet adjusted',
      bodyHtml: [
        `<p>Your TradeVero wallet was debited by support.</p>`,
        amountRow('Amount deducted', `-${formatUsd(params.amount)}`),
        `<p style="color:#6b7280;font-size:13px;">If you weren't expecting this, please contact support.</p>`,
      ].join(''),
    });
    await this.send({ to: params.to, subject: 'Wallet adjusted', html });
  }

  async sendOrderCompleted(params: {
    to: string;
    amount: string;
    productName: string | null;
    iccid: string | null;
  }): Promise<void> {
    const html = renderEmailLayout({
      heading: 'Your eSIM is ready 🎉',
      bodyHtml: [
        `<p>${params.productName ? `<strong>${params.productName}</strong> is` : 'Your eSIM is'} ready to install.</p>`,
        amountRow('Amount charged', `-${formatUsd(params.amount)}`),
        params.iccid
          ? `<p style="color:#6b7280;font-size:13px;">ICCID: ${params.iccid}</p>`
          : '',
        `<p>Open the app and go to <strong>My eSIMs</strong> to scan the QR code and install.</p>`,
      ].join(''),
    });
    await this.send({
      to: params.to,
      subject: 'Your eSIM is ready to install',
      html,
    });
  }

  /**
   * Notifies without disclosing. The card number and PIN are bearer
   * instruments, so email — which is neither authenticated nor encrypted at
   * rest on the recipient's side — only ever points back to the app.
   */
  async sendGiftCardReady(params: {
    to: string;
    amount: string;
    productName: string;
    faceValue: string;
  }): Promise<void> {
    const html = renderEmailLayout({
      heading: 'Your gift card is ready 🎁',
      bodyHtml: [
        `<p><strong>${params.productName}</strong> (${formatUsd(params.faceValue)}) has been issued.</p>`,
        amountRow('Amount charged', `-${formatUsd(params.amount)}`),
        `<p>Open the app and go to <strong>My Gift Cards</strong> to view your code.</p>`,
        `<p style="color:#6b7280;font-size:13px;">For your security the code is never sent by email — anyone holding it can spend it.</p>`,
      ].join(''),
    });
    await this.send({
      to: params.to,
      subject: 'Your gift card is ready',
      html,
    });
  }

  async sendOrderFailed(params: {
    to: string;
    amount: string;
    reasonText: string;
    kind:
      | 'PURCHASE'
      | 'TOPUP'
      | 'GIFT_CARD'
      | 'SMS_ONE_TIME'
      | 'NUMBER_RENTAL'
      | 'NUMBER_RENTAL_EXTEND';
  }): Promise<void> {
    const subject =
      params.kind === 'TOPUP'
        ? 'Your top-up could not be completed — refunded'
        : params.kind === 'GIFT_CARD'
          ? 'Your gift card purchase could not be completed — refunded'
          : params.kind === 'SMS_ONE_TIME'
            ? 'Your SMS verification could not be completed — refunded'
            : params.kind === 'NUMBER_RENTAL' ||
                params.kind === 'NUMBER_RENTAL_EXTEND'
              ? 'Your number rental could not be completed — refunded'
              : 'Your eSIM purchase could not be completed — refunded';
    const html = renderEmailLayout({
      heading: 'Order refunded',
      bodyHtml: [
        `<p>Unfortunately ${params.reasonText}, so we've refunded you in full.</p>`,
        amountRow('Amount refunded', `+${formatUsd(params.amount)}`),
        `<p style="color:#6b7280;font-size:13px;">No action needed — the funds are already back in your wallet.</p>`,
      ].join(''),
    });
    await this.send({ to: params.to, subject, html });
  }

  async sendTopUpCompleted(params: {
    to: string;
    amount: string;
  }): Promise<void> {
    const html = renderEmailLayout({
      heading: 'Top-up successful',
      bodyHtml: [
        `<p>Your eSIM has been topped up with more data/validity.</p>`,
        amountRow('Amount charged', `-${formatUsd(params.amount)}`),
      ].join(''),
    });
    await this.send({
      to: params.to,
      subject: 'Your eSIM top-up is complete',
      html,
    });
  }
}
