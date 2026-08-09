import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../common/dto/pagination.dto';
import { NotificationResponseDto } from './notification-response.dto';

export class PaginatedNotificationsResponseDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  data!: NotificationResponseDto[];

  @ApiProperty()
  meta!: PaginationMetaDto;

  @ApiProperty({
    example: 3,
    description:
      'Count of unread notifications, independent of the current page/filter.',
  })
  unreadCount!: number;
}
