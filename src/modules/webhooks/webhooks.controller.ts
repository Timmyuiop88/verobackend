import {
  Controller,
  Headers,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service';

// Server-to-server, signature-verified provider callbacks — not subject to
// the per-user/IP request throttling applied to the rest of the API.
@SkipThrottle()
@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('paystack')
  @ApiOperation({
    summary: 'Paystack deposit webhook',
    description: 'No Clerk auth. Verifies x-paystack-signature.',
  })
  @ApiOkResponse({ schema: { example: { received: true } } })
  handlePaystack(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature?: string,
  ) {
    const raw =
      req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    return this.webhooksService.handlePaystack(raw, signature);
  }

  @Post('oxapay')
  @ApiOperation({
    summary: 'OxaPay deposit webhook',
    description: 'No Clerk auth. Verifies HMAC signature header.',
  })
  @ApiOkResponse({ schema: { example: { received: true } } })
  handleOxapay(
    @Req() req: RawBodyRequest<Request>,
    @Headers('hmac') hmac?: string,
    @Headers('x-oxapay-signature') oxaSig?: string,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.webhooksService.handleOxapay(raw, hmac || oxaSig);
  }

  @Post('esim-access')
  @ApiOperation({
    summary: 'eSIM Access status/usage webhook',
    description: 'No Clerk auth. Verifies provider signature when configured.',
  })
  @ApiOkResponse({ schema: { example: { received: true } } })
  handleEsimAccess(
    @Req() req: RawBodyRequest<Request>,
    @Headers('rt-signature') signature?: string,
    @Headers('x-esim-signature') altSignature?: string,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.webhooksService.handleEsimAccess(
      raw,
      signature || altSignature,
    );
  }

  @Post('reloadly')
  @ApiOperation({
    summary: 'Reloadly gift card transaction status webhook',
    description: [
      'No Clerk auth. Register in Reloadly Dashboard → Developers → Webhooks:',
      '`https://<host>/api/v1/webhooks/reloadly`, service Gift Cards, event `giftcard_transaction.status`.',
      'Verifies `X-Reloadly-Signature` as HMAC-SHA256 of `body + ":" + X-Reloadly-Request-Timestamp`',
      'using `RELOADLY_WEBHOOK_SECRET` (the dashboard signing secret — not the API client secret).',
      'Local: point ngrok at this API. Completes/refunds gift card orders the same way the poll queue does.',
    ].join('\n'),
  })
  @ApiOkResponse({ schema: { example: { received: true } } })
  handleReloadly(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-reloadly-signature') signature?: string,
    @Headers('x-reloadly-request-timestamp') timestamp?: string,
  ) {
    const raw = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    return this.webhooksService.handleReloadly(raw, signature, timestamp);
  }
}
