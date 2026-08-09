import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import {
  InitializePaymentDto,
  PaymentInitializeResponseDto,
} from './dto/initialize-payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('paystack/initialize')
  @ApiOperation({
    summary: 'Initialize a Paystack fiat deposit',
    description:
      'Wallet credits are always USD; the actual charge currency/amount sent to Paystack is converted server-side (see `PAYSTACK_CURRENCY` / `PAYSTACK_USD_NGN_RATE`). Redirect the user to the returned `paymentUrl`; the wallet is credited once the `webhooks/paystack` callback confirms payment.',
  })
  @ApiCreatedResponse({ type: PaymentInitializeResponseDto })
  @ApiBadRequestResponse({
    description: 'Paystack rejected the request (e.g. unsupported currency)',
  })
  initializePaystack(
    @CurrentUser() user: User,
    @Body() dto: InitializePaymentDto,
  ): Promise<PaymentInitializeResponseDto> {
    return this.paymentsService.initializePaystack(user, dto);
  }

  @Post('oxapay/initialize')
  @ApiOperation({
    summary: 'Initialize an OxaPay crypto deposit',
    description:
      'Redirect the user to the returned `paymentUrl` (OxaPay-hosted checkout). The wallet is credited in USD once the `webhooks/oxapay` callback confirms payment.',
  })
  @ApiCreatedResponse({ type: PaymentInitializeResponseDto })
  @ApiBadRequestResponse({ description: 'OxaPay rejected the request' })
  initializeOxapay(
    @CurrentUser() user: User,
    @Body() dto: InitializePaymentDto,
  ): Promise<PaymentInitializeResponseDto> {
    return this.paymentsService.initializeOxapay(user, dto);
  }
}
