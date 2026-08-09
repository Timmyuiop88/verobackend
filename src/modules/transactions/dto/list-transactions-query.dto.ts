import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto';
import {
  TransactionCategory,
  TransactionDirection,
  TransactionFeedStatus,
} from './transaction-feed-item.dto';

export class ListTransactionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: TransactionCategory,
    description: 'Filter to one transaction category ("Category" dropdown)',
  })
  @IsOptional()
  @IsEnum(TransactionCategory)
  category?: TransactionCategory;

  @ApiPropertyOptional({
    enum: TransactionDirection,
    description: 'credit = money in, debit = money out ("Type" dropdown)',
  })
  @IsOptional()
  @IsEnum(TransactionDirection)
  type?: TransactionDirection;

  @ApiPropertyOptional({
    enum: TransactionFeedStatus,
    description: 'Normalized status ("Status" dropdown / tabs)',
  })
  @IsOptional()
  @IsEnum(TransactionFeedStatus)
  status?: TransactionFeedStatus;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-05-01',
    description: 'Inclusive start of date range',
  })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-05-15',
    description: 'Inclusive end of date range',
  })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
