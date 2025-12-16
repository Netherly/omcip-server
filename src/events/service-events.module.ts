import { Module } from '@nestjs/common';
import { ServiceEventsService } from './service-events.service';
import { TelegramNotificationService } from './telegram-notification.service';

@Module({
  providers: [ServiceEventsService, TelegramNotificationService],
  exports: [ServiceEventsService],
})
export class ServiceEventsModule {}
