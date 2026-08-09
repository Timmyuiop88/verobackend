import {
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { User } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ClerkAuthGuard } from '../../common/guards/clerk-auth.guard';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { PaginatedNotificationsResponseDto } from './dto/paginated-notifications-response.dto';
import { toNotificationResponse } from './notifications.mapper';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(ClerkAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my in-app notifications',
    description: [
      'In-app only — not push notifications. Fed by backend events (deposits, order',
      'completion/failure, top-ups). Paginated, newest first. `unreadCount` in the response',
      'is the total unread count regardless of the current page/filter — use it for a badge.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: PaginatedNotificationsResponseDto })
  async list(
    @CurrentUser() user: User,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedNotificationsResponseDto> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const { notifications, total, unreadCount } =
      await this.notificationsService.listForUser(user.id, {
        page,
        limit,
        unreadOnly: query.unreadOnly,
      });
    return {
      data: notifications.map(toNotificationResponse),
      meta: this.notificationsService.buildMeta(page, limit, total),
      unreadCount,
    };
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count (for a badge)' })
  @ApiOkResponse({
    schema: { properties: { unreadCount: { type: 'number' } } },
  })
  async getUnreadCount(
    @CurrentUser() user: User,
  ): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notificationsService.unreadCount(user.id);
    return { unreadCount };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all my notifications as read' })
  @ApiOkResponse({ schema: { properties: { updated: { type: 'number' } } } })
  async markAllRead(@CurrentUser() user: User): Promise<{ updated: number }> {
    return this.notificationsService.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiParam({ name: 'id', format: 'uuid', description: 'Notification id' })
  @ApiOperation({ summary: 'Mark a single notification as read' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  async markRead(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<NotificationResponseDto> {
    const notification = await this.notificationsService.markRead(user.id, id);
    return toNotificationResponse(notification);
  }
}
