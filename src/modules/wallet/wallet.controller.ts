import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { WalletResponseDto } from './dto/wallet-response.dto';
import { WalletService } from './wallet.service';

@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get wallet balance and recent transactions' })
  @ApiOkResponse({ type: WalletResponseDto })
  async getWallet(@CurrentUser() user: User): Promise<WalletResponseDto> {
    const { wallet, transactions } =
      await this.walletService.getWalletWithTransactions(user.id);

    return {
      id: wallet.id,
      balance: wallet.balance.toString(),
      currency: wallet.currency,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        balanceAfter: tx.balanceAfter.toString(),
        reference: tx.reference,
        status: tx.status,
        createdAt: tx.createdAt,
      })),
    };
  }
}
