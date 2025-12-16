import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Referral } from './entities/referral.entity';
import { User } from '../user/entities/user.entity';

@Injectable()
export class ReferralService {
  private readonly logger = new Logger(ReferralService.name);

  constructor(
    @InjectRepository(Referral)
    private referralRepository: Repository<Referral>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * Generate unique referral code for user
   */
  generateReferralCode(userId: string): string {
    // Используем base64 кодирование userId для уникальности
    const encoded = Buffer.from(userId).toString('base64');
    // Убираем лишние символы и берем первые 8 символов
    return encoded.replace(/[^a-zA-Z0-9]/g, '').substring(0, 8).toUpperCase();
  }

  /**
   * Get referral link for user
   */
  async getReferralLink(userId: string, botUsername: string): Promise<string> {
    const code = this.generateReferralCode(userId);
    // Telegram Mini App start parameter format
    return `https://t.me/${botUsername}?start=ref_${code}`;
  }

  /**
   * Process referral when new user joins via link
   */
  async processReferral(
    referredUserId: string,
    referralCode: string,
  ): Promise<boolean> {
    try {
      // Находим реферера по коду
      const allUsers = await this.userRepository.find();
      const referrer = allUsers.find(
        (user) => this.generateReferralCode(user.id) === referralCode,
      );

      if (!referrer) {
        this.logger.warn(`Referrer not found for code: ${referralCode}`);
        return false;
      }

      // Проверяем что пользователь не приглашает сам себя
      if (referrer.id === referredUserId) {
        this.logger.warn('User tried to refer themselves');
        return false;
      }

      // Проверяем что реферал еще не зарегистрирован
      const existing = await this.referralRepository.findOne({
        where: { referred_id: referredUserId as any },
      });

      if (existing) {
        this.logger.warn(`User ${referredUserId} already has a referrer`);
        return false;
      }

      // Создаем запись реферала
      const referral = this.referralRepository.create({
        referrer_id: referrer.id as any,
        referred_id: referredUserId as any,
        reward_claimed: false,
        coins_earned: 0,
      });

      await this.referralRepository.save(referral);

      // Увеличиваем счетчики для заданий
      await this.incrementReferralCounters(referrer.id);

      this.logger.log(
        `Referral created: ${referrer.id} -> ${referredUserId}`,
      );

      return true;
    } catch (error) {
      this.logger.error('Failed to process referral:', error);
      return false;
    }
  }

  /**
   * Get list of users referred by specific user
   */
  async getUserReferrals(userId: string): Promise<any[]> {
    const referrals = await this.referralRepository.find({
      where: { referrer_id: userId as any },
      relations: ['referred'],
      order: { created_at: 'DESC' },
    });

    return referrals.map((ref) => ({
      id: ref.id,
      userId: ref.referred_id,
      username: ref.referred?.username || ref.referred?.first_name || 'User',
      joinedAt: ref.created_at,
    }));
  }

  /**
   * Get count of referrals for user
   */
  async getReferralCount(userId: string): Promise<number> {
    return this.referralRepository.count({
      where: { referrer_id: userId as any },
    });
  }



  /**
   * Get referral stats for user
   */
  async getReferralStats(userId: string): Promise<{
    totalReferrals: number;
    referralLink: string;
  }> {
    const count = await this.getReferralCount(userId);
    const botUsername = process.env.BOT_USERNAME || 'your_bot';
    const link = await this.getReferralLink(userId, botUsername);

    return {
      totalReferrals: count,
      referralLink: link,
    };
  }

  /**
   * Increment daily and weekly referral counters for tasks
   */
  private async incrementReferralCounters(referrerId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: referrerId },
    });

    if (!user) return;

    const now = new Date();

    // Проверяем нужен ли daily reset
    if (this.needsDailyReset(user.last_daily_reset)) {
      user.daily_invited_friends = 0;
      user.last_daily_reset = now;
    }

    // Проверяем нужен ли weekly reset
    if (this.needsWeeklyReset(user.last_weekly_reset)) {
      user.weekly_invited_friends = 0;
      user.last_weekly_reset = now;
    }

    // Увеличиваем счетчики
    user.daily_invited_friends = (user.daily_invited_friends || 0) + 1;
    user.weekly_invited_friends = (user.weekly_invited_friends || 0) + 1;

    await this.userRepository.save(user);

    this.logger.log(
      `Incremented referral counters for ${referrerId}: daily=${user.daily_invited_friends}, weekly=${user.weekly_invited_friends}`,
    );
  }

  /**
   * Check if daily reset is needed
   */
  private needsDailyReset(lastReset: Date | null): boolean {
    if (!lastReset) return true;

    const now = new Date();
    const lastResetDate = new Date(lastReset);

    // Сброс в 00:00
    const todayMidnight = new Date(now);
    todayMidnight.setHours(0, 0, 0, 0);

    const lastResetMidnight = new Date(lastResetDate);
    lastResetMidnight.setHours(0, 0, 0, 0);

    return todayMidnight.getTime() > lastResetMidnight.getTime();
  }

  /**
   * Check if weekly reset is needed
   */
  private needsWeeklyReset(lastReset: Date | null): boolean {
    if (!lastReset) return true;

    const now = new Date();
    const lastResetDate = new Date(lastReset);

    // Разница в днях
    const daysDiff = Math.floor(
      (now.getTime() - lastResetDate.getTime()) / (1000 * 60 * 60 * 24),
    );

    // Сброс каждые 7 дней
    return daysDiff >= 7;
  }

  /**
   * Get task-specific referral counts for user
   */
  async getTaskReferralCounts(userId: string): Promise<{
    dailyInvitedFriends: number;
    weeklyInvitedFriends: number;
  }> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      return {
        dailyInvitedFriends: 0,
        weeklyInvitedFriends: 0,
      };
    }

    // Проверяем нужны ли сбросы
    let dailyCount = user.daily_invited_friends || 0;
    let weeklyCount = user.weekly_invited_friends || 0;

    if (this.needsDailyReset(user.last_daily_reset)) {
      dailyCount = 0;
      // Можем обновить в БД
      user.daily_invited_friends = 0;
      user.last_daily_reset = new Date();
      await this.userRepository.save(user);
    }

    if (this.needsWeeklyReset(user.last_weekly_reset)) {
      weeklyCount = 0;
      // Можем обновить в БД
      user.weekly_invited_friends = 0;
      user.last_weekly_reset = new Date();
      await this.userRepository.save(user);
    }

    return {
      dailyInvitedFriends: dailyCount,
      weeklyInvitedFriends: weeklyCount,
    };
  }

  /**
   * Reset daily referral counter (вызывается при сбросе daily tasks)
   */
  async resetDailyReferralCounter(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (user) {
      user.daily_invited_friends = 0;
      user.last_daily_reset = new Date();
      await this.userRepository.save(user);
      this.logger.log(`Reset daily referral counter for ${userId}`);
    }
  }

  /**
   * Reset weekly referral counter (вызывается при сбросе weekly tasks)
   */
  async resetWeeklyReferralCounter(userId: string): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (user) {
      user.weekly_invited_friends = 0;
      user.last_weekly_reset = new Date();
      await this.userRepository.save(user);
      this.logger.log(`Reset weekly referral counter for ${userId}`);
    }
  }
}
