import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface ServicePurchasedEvent {
  userId: string;
  telegram_id: number;
  serviceId: string;
  serviceName: string;
  cost: number;
  purchasedAt: Date;
  cooldownDays?: number;
  userName?: string;
  username?: string;
  first_name?: string;
}

@Injectable()
export class ServiceEventsService {
  private readonly logger = new Logger(ServiceEventsService.name);

  constructor(private eventEmitter: EventEmitter2) {}

  /**
   * Emit service purchased event
   * This event can be consumed by bot integration, analytics, etc.
   */
  emitServicePurchased(data: ServicePurchasedEvent): void {
    this.logger.log({
      event: 'service.purchased',
      userId: data.userId,
      serviceId: data.serviceId,
      serviceName: data.serviceName,
      cost: data.cost,
      telegram_id: data.telegram_id,
    });

    this.eventEmitter.emit('service.purchased', data);
  }
}
