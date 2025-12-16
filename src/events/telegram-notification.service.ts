import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as ServiceEvents from './service-events.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TelegramNotificationService implements OnModuleInit {
  private readonly logger = new Logger(TelegramNotificationService.name);
  private botToken: string;
  private adminIds: number[];

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN') || '';
    const adminIdsStr = this.configService.get<string>('ADMIN_IDS', '');
    this.adminIds = adminIdsStr
      .split(',')
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id));

    if (!this.botToken) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not configured. Notifications disabled.');
    }
  }

  /**
   * Listen to service.purchased event and send notifications
   */
  @OnEvent('service.purchased')
  async handleServicePurchased(event: ServiceEvents.ServicePurchasedEvent) {
    if (!this.botToken) {
      this.logger.warn('Cannot send notification: bot token not configured');
      return;
    }

    try {
      // Send notification to user
      await this.sendUserNotification(event);

      // Send notifications to all admins
      await this.sendAdminNotifications(event);
    } catch (error) {
      this.logger.error('Failed to send Telegram notifications:', error);
    }
  }

  /**
   * Send notification to the user who purchased the service
   */
  private async sendUserNotification(event: ServiceEvents.ServicePurchasedEvent): Promise<void> {
    const message =
      `✅ <b>Услуга куплена!</b>\n\n` +
      `📦 <b>Название:</b> ${this.escapeHtml(event.serviceName)}\n` +
      `💰 <b>Стоимость:</b> ${event.cost.toLocaleString('ru-RU')} монет\n` +
      `📅 <b>Дата:</b> ${this.formatDate(event.purchasedAt)}\n\n` +
      `Для использования услуги обратитесь в клинику.`;

    try {
      await this.sendTelegramMessage(event.telegram_id, message);
      this.logger.log(`User notification sent to ${event.telegram_id}`);
    } catch (error) {
      this.logger.error(`Failed to send user notification to ${event.telegram_id}:`, error.message);
    }
  }

  /**
   * Send notifications to all administrators
   */
  private async sendAdminNotifications(event: ServiceEvents.ServicePurchasedEvent): Promise<void> {
    if (!this.adminIds || this.adminIds.length === 0) {
      this.logger.warn('No admin IDs configured');
      return;
    }

    const userName = event.first_name || 'Пользователь';
    const username = event.username ? `@${event.username}` : '';

    const message =
      `🔔 <b>НОВАЯ ПОКУПКА УСЛУГИ</b>\n\n` +
      `👤 <b>Пользователь:</b> ${this.escapeHtml(userName)} ${username}\n` +
      `🆔 <b>Telegram ID:</b> <code>${event.telegram_id}</code>\n` +
      `📦 <b>Услуга:</b> ${this.escapeHtml(event.serviceName)}\n` +
      `💰 <b>Стоимость:</b> ${event.cost.toLocaleString('ru-RU')} монет\n` +
      `📅 <b>Время:</b> ${this.formatDateTime(event.purchasedAt)}`;

    const notificationPromises = this.adminIds.map(async (adminId) => {
      try {
        await this.sendTelegramMessage(adminId, message);
        this.logger.log(`Admin notification sent to ${adminId}`);
      } catch (error) {
        this.logger.error(`Failed to send admin notification to ${adminId}:`, error.message);
      }
    });

    await Promise.allSettled(notificationPromises);
  }

  /**
   * Send message via Telegram Bot API
   */
  private async sendTelegramMessage(chatId: number, text: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'HTML',
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Telegram API error: ${JSON.stringify(error)}`);
    }
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Format date for display
   */
  private formatDate(date: Date): string {
    return new Date(date).toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }

  /**
   * Format date and time for display
   */
  private formatDateTime(date: Date): string {
    return new Date(date).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
