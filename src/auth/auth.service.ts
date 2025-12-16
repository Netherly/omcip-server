import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { TasksService } from '../tasks/tasks.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';
import { ConfigService } from '@nestjs/config';
import { parse } from '@telegram-apps/init-data-node';

@Injectable()
export class AuthService {
  constructor(
    private userService: UserService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private tasksService: TasksService,
  ) {}

  async validateTelegramAuth(telegramAuthDto: TelegramAuthDto) {
    const { initData } = telegramAuthDto;

    if (!initData) {
      throw new UnauthorizedException('Missing initData for validation');
    }

    try {
      // Парсим initData для получения данных пользователя
      const parsedData = parse(initData);
      const user_data = parsedData.user as any;
      
      if (!user_data) {
        throw new Error('User data not found in initData');
      }
      
      // Ищем или создаём пользователя
      let user = await this.userService.findByTelegramId(user_data.id);

      if (!user) {
        user = await this.userService.create({
          telegram_id: user_data.id,
          username: user_data.username,
          first_name: user_data.firstName,
          photo_url: user_data.photoUrl,
        });

        // Инициализируем задачи для нового пользователя
        await this.tasksService.initializeTasksForUser(user.id);
      } else {
        user = await this.userService.update(user.id, {
          username: user_data.username,
          first_name: user_data.firstName,
          photo_url: user_data.photoUrl,
          last_login_at: new Date(),
        });
      }

      const token = this.generateJwtToken(user);

      const response = {
        success: true,
        user: {
          id: user.id,
          telegram_id: user.telegram_id,
          username: user.username,
          first_name: user.first_name,
          coins: user.coins,
          energy: user.energy,
          max_energy: user.max_energy,
          level: user.level,
        },
        token,
      };
      
      return response;
    } catch (error) {
      console.error('[AuthService] Error:', error.message);
      throw new UnauthorizedException('Invalid Telegram authentication: ' + error.message);
    }
  }

  private generateJwtToken(user: any): string {
    const payload = {
      sub: String(user.id),
      telegram_id: user.telegram_id,
      username: user.username,
    };
    return this.jwtService.sign(payload);
  }

  generateDebugToken(): any {
    // For development: generate token for test user with telegram_id=999999999
    const payload = {
      sub: 'debug-test-user',
      telegram_id: 999999999,
      username: 'test_user',
    };
    const token = this.jwtService.sign(payload);
    return { token, payload };
  }
}