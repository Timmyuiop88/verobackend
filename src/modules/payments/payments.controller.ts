import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
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
  @ApiOperation({ summary: 'Initialize a Paystack fiat deposit' })
  @ApiCreatedResponse({ type: PaymentInitializeResponseDto })
  initializePaystack(
    @CurrentUser() user: User,
    @Body() dto: InitializePaymentDto,
  ): Promise<PaymentInitializeResponseDto> {
    return this.paymentsService.initializePaystack(user, dto);
  }

  @Post('oxapay/initialize')
  @ApiOperation({ summary: 'Initialize an OxaPay crypto deposit' })
  @ApiCreatedResponse({ type: PaymentInitializeResponseDto })
  initializeOxapay(
    @CurrentUser() user: User,
    @Body() dto: InitializePaymentDto,
  ): Promise<PaymentInitializeResponseDto> {
    return this.paymentsService.initializeOxapay(user, dto);
  }
}
