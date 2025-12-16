import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { ReferralService } from './referral.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('referral')
@UseGuards(JwtAuthGuard)
export class ReferralController {
  private readonly logger = new Logger(ReferralController.name);

  constructor(private readonly referralService: ReferralService) {}

  /**
   * Get referral link for current user
   * GET /referral/link/:userId
   */
  @Get('link/:userId')
  async getReferralLink(@Param('userId') userId: string) {
    const botUsername = process.env.BOT_USERNAME || 'your_bot';
    const link = await this.referralService.getReferralLink(userId, botUsername);

    return {
      success: true,
      referralLink: link,
      code: this.referralService.generateReferralCode(userId),
    };
  }

  /**
   * Process referral registration
   * POST /referral/register
   * Body: { userId: string, referralCode: string }
   */
  @Post('register')
  async registerReferral(
    @Body() body: { userId: string; referralCode: string },
  ) {
    const { userId, referralCode } = body;

    // Извлекаем код из формата "ref_XXXXX"
    const code = referralCode.replace('ref_', '');

    const success = await this.referralService.processReferral(userId, code);

    if (success) {
      return {
        success: true,
        message: 'Referral registered successfully',
      };
    } else {
      return {
        success: false,
        message: 'Failed to register referral',
      };
    }
  }

  /**
   * Get user's referrals list
   * GET /referral/list/:userId
   */
  @Get('list/:userId')
  async getUserReferrals(@Param('userId') userId: string) {
    const referrals = await this.referralService.getUserReferrals(userId);

    return {
      success: true,
      referrals,
      count: referrals.length,
    };
  }

  /**
   * Get referral stats
   * GET /referral/stats/:userId
   */
  @Get('stats/:userId')
  async getReferralStats(@Param('userId') userId: string) {
    const stats = await this.referralService.getReferralStats(userId);

    return {
      success: true,
      ...stats,
    };
  }

  /**
   * Get task-specific referral counts
   * GET /referral/task-counts/:userId
   */
  @Get('task-counts/:userId')
  async getTaskReferralCounts(@Param('userId') userId: string) {
    const counts = await this.referralService.getTaskReferralCounts(userId);

    return {
      success: true,
      ...counts,
    };
  }

  /**
   * Reset daily referral counter
   * POST /referral/reset-daily/:userId
   */
  @Post('reset-daily/:userId')
  async resetDailyCounter(@Param('userId') userId: string) {
    await this.referralService.resetDailyReferralCounter(userId);

    return {
      success: true,
      message: 'Daily referral counter reset',
    };
  }

  /**
   * Reset weekly referral counter
   * POST /referral/reset-weekly/:userId
   */
  @Post('reset-weekly/:userId')
  async resetWeeklyCounter(@Param('userId') userId: string) {
    await this.referralService.resetWeeklyReferralCounter(userId);

    return {
      success: true,
      message: 'Weekly referral counter reset',
    };
  }

}
