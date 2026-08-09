import { Module } from '@nestjs/common';
import { EmailModule } from '../integrations/email/email.module';
import { EmailEventListener } from './listeners/email-event.listener';
import { NotificationsEventListener } from './listeners/notifications-event.listener';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [EmailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsEventListener,
    EmailEventListener,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
