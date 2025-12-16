import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  BadRequestException,
  ParseIntPipe,
} from '@nestjs/common';
import { LoginRewardsService } from '../services/login-rewards.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@Controller('login-rewards')
export class LoginRewardsController {
  constructor(private loginRewardsService: LoginRewardsService) {}

  /**
   * GET /api/login-rewards
   * Получить все 7 дневных наград + текущий streak
   */
  @UseGuards(JwtAuthGuard)
  @Get()
  async getLoginRewards(@Request() req) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const data = await this.loginRewardsService.getLoginRewards(userId);
    return {
      success: true,
      data,
    };
  }

  /**
   * GET /api/login-rewards/streak
   * Получить только текущий streak
   */
  @UseGuards(JwtAuthGuard)
  @Get('streak')
  async getCurrentStreak(@Request() req) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new BadRequestException('User not authenticated');
    }

    const streak = await this.loginRewardsService.getCurrentLoginStreak(userId);
    return {
      success: true,
      data: {
        current_streak: streak,
      },
    };
  }

  /**
   * POST /api/login-rewards/:day/claim
   * Забрать награду за конкретный день
   */
  @UseGuards(JwtAuthGuard)
  @Post(':day/claim')
  async claimLoginReward(
    @Param('day', ParseIntPipe) day: number,
    @Request() req,
  ) {
    const userId = req.user.sub;

    const result = await this.loginRewardsService.claimLoginReward(
      userId,
      day,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /api/login-rewards/skip/:taskId
   * Автоматически выполнить ежедневное задание (TASK_SKIP награда)
   */
  @UseGuards(JwtAuthGuard)
  @Post('skip/:taskId')
  async skipDailyTask(
    @Param('taskId') taskId: string,
    @Request() req,
  ) {
    const userId = req.user.sub;

    const result = await this.loginRewardsService.skipDailyTask(
      userId,
      taskId,
    );

    return {
      success: true,
      data: result,
    };
  }
}
