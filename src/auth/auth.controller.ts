import { Controller, Post, Body, Get } from '@nestjs/common';
import { AuthService } from './auth.service';
import { TelegramAuthDto } from './dto/telegram-auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Get('health')
  health() {
    return { status: 'ok', message: 'Auth service is running' };
  }

  @Post('telegram')
  async login(@Body() telegramAuthDto: TelegramAuthDto) {
    try {
      const result = await this.authService.validateTelegramAuth(telegramAuthDto);
      return result;
    } catch (error) {
      console.error('[AuthController] Authentication error:', error);
      throw error;
    }
  }

  @Get('debug-token')
  debugToken() {
    return this.authService.generateDebugToken();
  }
}


