import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import { TransactionFeedItemDto } from './transaction-feed-item.dto';

export class PaginatedTransactionsResponseDto {
  @ApiProperty({ type: [TransactionFeedItemDto] })
  data!: TransactionFeedItemDto[];

  @ApiProperty()
  meta!: PaginationMetaDto;
}
