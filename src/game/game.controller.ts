import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { GameService } from './game.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClickDto } from './dto/click.dto';
import { ActivateBoostDto } from './dto/activate-boost.dto';

@Controller('game')
@UseGuards(JwtAuthGuard)
export class GameController {
  constructor(private readonly gameService: GameService) {}

  // Получить состояние игры
  @Get('state')
  async getState(
    @CurrentUser('sub') userId: string,
  ) {
    return this.gameService.getGameState(userId);
  }

  // Обработка кликов (REST API fallback если WebSocket не работает)
  @Post('click')
  @HttpCode(HttpStatus.OK)
  async click(@CurrentUser('sub') userId: string, @Body() clickDto: ClickDto) {
    return this.gameService.handleClick(userId, clickDto);
  }

  // Активировать буст
  @Post('boost/activate')
  @HttpCode(HttpStatus.OK)
  async activateBoost(
    @CurrentUser('sub') userId: string,
    @Body() dto: ActivateBoostDto,
  ) {
    return this.gameService.activateBoost(
      userId,
      dto.type,
      dto.multiplier,
      dto.durationSeconds,
    );
  }
}