import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import { PaginatedTransactionsResponseDto } from './dto/paginated-transactions-response.dto';
import { TransactionsService } from './transactions.service';

@ApiTags('transactions')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Unified transactions feed (eSIM purchases/top-ups + wallet activity)',
    description: [
      'Merges eSIM orders (purchases, top-ups) and wallet ledger entries (deposits, refunds,',
      'admin adjustments) into one timeline, newest first — one feed to power a single',
      '"Transactions" screen instead of stitching together GET /orders and GET /wallet.',
      '',
      'Filters: `category` (eSIM/wallet sub-type), `type` (credit=money in / debit=money out),',
      '`status` (normalized COMPLETED/PENDING/FAILED — drives All/Completed/Pending/Failed tabs),',
      '`dateFrom`/`dateTo` (inclusive day range).',
      '',
      'Note: "Rent a Number" / "Gift Card" style categories are not part of TradeVero today —',
      'only eSIM + wallet activity exist — but `category` is designed to grow to cover them',
      'later without breaking this shape.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: PaginatedTransactionsResponseDto })
  async list(
    @CurrentUser() user: User,
    @Query() query: ListTransactionsQueryDto,
  ): Promise<PaginatedTransactionsResponseDto> {
    return this.transactionsService.listForUser(user.id, query);
  }
}
