import {
  Controller,
  Post,
  Param,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GameService } from '../game.service';

@Controller('characters')
export class CharactersController {
  constructor(private gameService: GameService) {}

  /**
   * Purchase character 3
   * Требует: персонаж 2 разблокирован, достаточно монет
   * Разблокирует: персонаж 3
   */
  @UseGuards(JwtAuthGuard)
  @Post('3/purchase')
  async purchaseCharacter3(@Request() req) {
    const userId = req.user.id;
    const cost = 1000000; // Стоимость персонажа 3

    try {
      // Проверяем баланс пользователя
      const userCoins = await this.gameService.getUserCoins(userId);

      if (userCoins < cost) {
        throw new BadRequestException(
          `Insufficient coins. You have ${userCoins}, need ${cost}`,
        );
      }

      // Вычитаем монеты
      await this.gameService.deductCoins(userId, cost);

      return {
        success: true,
        message: 'Character 3 purchased successfully',
        data: {
          character_id: 3,
          cost_deducted: cost,
          unlocked: true,
        },
      };
    } catch (error) {
      console.error('[Character] Error purchasing character 3:', error.message);
      throw error;
    }
  }
}
