import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnEvent } from '@nestjs/event-emitter';
import { GameService } from './game.service';
import { UserService } from '../user/user.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { ClickDto } from './dto/click.dto';
import * as ServiceEvents from '../events/service-events.service';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'https://aed8b6a50f58.ngrok-free.app'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('GameGateway');
  private energyRecoveryIntervals = new Map<string, NodeJS.Timeout>();
  private autoClickerIntervals = new Map<string, NodeJS.Timeout>();

  constructor(
    private gameService: GameService,
    private userService: UserService,
    private jwtService: JwtService,
  ) {}

  // Подключение клиента
  async handleConnection(@ConnectedSocket() client: Socket) {
    try {
      // Токен передается в auth
      const token = client.handshake?.auth?.token || client.handshake?.query?.token;

      if (!token) {
        this.logger.error(`[handleConnection] No token provided`);
        client.disconnect();
        return;
      }

      // Проверяем токен вручную (WsJwtGuard не может быть использован здесь)
      let userId: string;
      try {
        const payload = await this.validateToken(token);
        userId = payload.sub || payload.id;
        client.data.userId = userId;
      } catch (error) {
        this.logger.error(`[handleConnection] Token validation failed:`, error.message);
        client.disconnect();
        return;
      }

      // Отправляем начальное состояние
      if (userId) {
        const gameState = await this.gameService.getGameState(userId);
        client.emit('game:state', gameState);
        client.data.user = gameState.user;

        // Запускаем восстановление энергии для этого клиента
        this.startEnergyRecovery(client, userId);
      }
    } catch (error) {
      this.logger.error(`Connection error: ${error.message}`);
      client.disconnect();
    }
  }

  // Отключение клиента
  handleDisconnect(@ConnectedSocket() client: Socket) {
    // Останавливаем восстановление энергии
    this.stopEnergyRecovery(client.id);
    
    // Останавливаем автокликер
    this.stopAutoClicker(client.id);
  }

  // Обработка кликов
  @SubscribeMessage('game:click')
  async handleClick(
    @MessageBody() clickDto: ClickDto,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const userId = client.data.userId;

      const result = await this.gameService.handleClick(userId, clickDto);
      
      // Отправляем ТОЛЬКО результат клика, БЕЗ полного состояния
      client.emit('game:click:result', result);
      
      // Энергия обновится через отдельное сообщение energy:update каждые 5 сек
    } catch (error) {
      this.logger.error(`[handleClick] Error processing click:`, error.message);
      client.emit('game:error', {
        message: error.message,
        code: error.status || 500,
      });
      throw error;
    }
  }

  // Запрос текущего состояния
  @SubscribeMessage('game:getState')
  async handleGetState(@ConnectedSocket() client: Socket) {
    try {
      const userId = client.data.userId;
      const gameState = await this.gameService.getGameState(userId);

      client.emit('game:state', gameState);

      return gameState;
    } catch (error) {
      client.emit('game:error', {
        message: error.message,
        code: error.status || 500,
      });
    }
  }

  // Автоматическое восстановление энергии
  private startEnergyRecovery(client: Socket, userId: string) {
    let lastSentEnergy: number | null = null;

    // Проверяем изменение энергии и отправляем только при необходимости
    // БЕЗ запроса к БД - используем только кэш
    const interval = setInterval(() => {
      try {
        // Получаем энергию ТОЛЬКО из памяти (без БД запроса)
        const energyData = this.gameService.getEnergyFromCache(userId);
        
        if (!energyData) {
          // Кэш ещё не инициализирован, пропускаем
          return;
        }

        const currentEnergy = energyData.energy;

        // Отправляем обновление энергии только если она изменилась
        if (lastSentEnergy === null || lastSentEnergy !== currentEnergy) {
          client.emit('game:energy:update', {
            energy: currentEnergy,
            max_energy: energyData.max_energy,
          });
          lastSentEnergy = currentEnergy;
        }
      } catch (error) {
        this.logger.error(`Energy recovery error: ${error.message}`);
      }
    }, 5000); // Проверяем каждые 5 секунд, БЕЗ запроса к БД

    this.energyRecoveryIntervals.set(client.id, interval);
    
    // Запускаем автокликер (добавление монет каждые 10 сек)
    this.startAutoClicker(client, userId);
  }

  // Автокликер: добавление монет в реальном времени
  private startAutoClicker(client: Socket, userId: string) {
    const interval = setInterval(async () => {
      try {
        const earnings = await this.gameService.addAutoClickerEarnings(userId);
        
        if (earnings) {
          client.emit('game:autoclicker:earnings', {
            coins: earnings.coins,
            earned: earnings.earned,
          });
        }
      } catch (error) {
        this.logger.error(`AutoClicker error: ${error.message}`);
      }
    }, 10000); // Добавляем монеты каждые 10 секунд

    this.autoClickerIntervals.set(client.id, interval);
  }

  private stopAutoClicker(clientId: string) {
    const interval = this.autoClickerIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.autoClickerIntervals.delete(clientId);
    }
  }

  private stopEnergyRecovery(clientId: string) {
    const interval = this.energyRecoveryIntervals.get(clientId);
    if (interval) {
      clearInterval(interval);
      this.energyRecoveryIntervals.delete(clientId);
    }
  }

  // Метод для отправки уведомлений всем пользователям
  broadcastNotification(message: string) {
    this.server.emit('game:notification', { message });
  }

  // Метод для отправки уведомления конкретному пользователю
  sendNotificationToUser(userId: string, message: string) {
    // Находим socket пользователя
    const clients = Array.from(this.server.sockets.sockets.values());
    const userSocket = clients.find((socket) => socket.data.user?.sub === userId);

    if (userSocket) {
      userSocket.emit('game:notification', { message });
    }
  }

  // Валидация JWT токена
  private async validateToken(token: string): Promise<any> {
    try {
      const payload = await this.jwtService.verifyAsync(token);

      // Load full user from database (same as in JWT strategy)
      let user: any = null;
      if (payload.telegram_id) {
        user = await this.userService.findByTelegramId(payload.telegram_id);
      } else if (payload.sub) {
        try {
          user = await this.userService.findOne(payload.sub);
        } catch (e) {
          // User lookup failed
        }
      }

      if (!user) {
        throw new Error('User not found in database');
      }

      // Return full user object with 'sub' as UUID (not the JWT sub)
      return {
        ...user,
        sub: user.id, // Use database UUID instead of JWT sub
      };
    } catch (error) {
      throw new Error('Invalid token: ' + error.message);
    }
  }

  // ===== TASK EVENTS =====

  // Вспомогательный метод: найти socket клиента по userId
  private findSocketByUserId(userId: string): Socket | undefined {
    const clients = Array.from(this.server.sockets.sockets.values());
    return clients.find((socket) => socket.data.userId === userId);
  }

  @OnEvent('task.completed')
  handleTaskCompleted(payload: { userId: string; taskId: string }) {
    // Находим socket клиента по userId
    const clientSocket = this.findSocketByUserId(payload.userId);
    
    if (clientSocket) {
      clientSocket.emit('task:completed', { taskId: payload.taskId });
    } else {
      this.logger.warn(`[handleTaskCompleted] No socket found for user ${payload.userId}`);
    }
  }

  @OnEvent('task.claimed')
  handleTaskClaimed(payload: { userId: string; taskId: string; rewardCoins: number }) {
    // Находим socket клиента по userId
    const clientSocket = this.findSocketByUserId(payload.userId);
    
    if (clientSocket) {
      clientSocket.emit('task:claimed', { taskId: payload.taskId, reward_coins: payload.rewardCoins });
    } else {
      this.logger.warn(`[handleTaskClaimed] No socket found for user ${payload.userId}`);
    }
  }

  @OnEvent('service.purchased')
  handleServicePurchased(event: ServiceEvents.ServicePurchasedEvent) {
    // Находим socket клиента по userId
    const clientSocket = this.findSocketByUserId(event.userId);
    
    if (clientSocket) {
      clientSocket.emit('service:purchased', {
        serviceId: event.serviceId,
        serviceName: event.serviceName,
        cost: event.cost,
        purchasedAt: event.purchasedAt,
        cooldownDays: event.cooldownDays || 0,
      });
    } else{
      this.logger.warn(`[handleServicePurchased] No socket found for user ${event.userId}`);
    }

    // Отправляем всем админам (broadcast)
    this.server.emit('admin:service:purchased', {
      userId: event.userId,
      userName: event.userName || 'Unknown',
      serviceId: event.serviceId,
      serviceName: event.serviceName,
      cost: event.cost,
      purchasedAt: event.purchasedAt,
    });
  }
}