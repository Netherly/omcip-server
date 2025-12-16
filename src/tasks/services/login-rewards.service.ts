import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { validate as isUUID } from 'uuid';
import { User } from '../../user/entities/user.entity';
import { UserDailyClaim } from '../entities/user-daily-claim.entity';
import { DailyBonus, RewardType } from '../entities/daily-bonus.entity';
import { UserBoost, BoostType } from '../../game/entities/user-boost.entity';
import { UserTask } from '../entities/user-task.entity';
import { Task, TaskActionType, TaskPeriod } from '../entities/task.entity';
import { GameService } from '../../game/game.service';

export interface LoginRewardResponse {
  day: number;
  title: string;
  description: string;
  reward_type: RewardType;
  reward_coins?: number;
  boost_multiplier?: number;
  boost_duration?: number;
  claimed: boolean;
}

@Injectable()
export class LoginRewardsService {
  private readonly logger = new Logger(LoginRewardsService.name);

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserDailyClaim)
    private userDailyClaimRepository: Repository<UserDailyClaim>,
    @InjectRepository(DailyBonus)
    private dailyBonusRepository: Repository<DailyBonus>,
    @InjectRepository(UserBoost)
    private userBoostRepository: Repository<UserBoost>,
    @InjectRepository(UserTask)
    private userTaskRepository: Repository<UserTask>,
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    private gameService: GameService,
  ) {}

  /**
   * Получить текущий streak пользователя
   */
  async getCurrentLoginStreak(userId: string): Promise<number> {
    if (!isUUID(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }

    try {
      // Получаем все claims пользователя за последние дни
      const claims = await this.userDailyClaimRepository.find({
        where: { user_id: userId },
        order: { claimed_at: 'DESC' },
      });

      if (claims.length === 0) {
        this.logger.debug(`User ${userId} has no claims yet`);
        return 0; // Нет клеймов - день 1 доступен
      }

      const lastClaim = claims[0];

      // Проверяем дату последней клейма
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const claimDate = new Date(lastClaim.claimed_at);
      claimDate.setHours(0, 0, 0, 0);

      const diffTime = today.getTime() - claimDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      // Если был вход более чем 1 день назад, стрик сбрасывается
      if (diffDays > 1) {
        this.logger.debug(`User ${userId} streak broken (${diffDays} days gap)`);
        return 1; // Стрик сброшен - доступен день 1
      }

      // Если был вход вчера, переходим на следующий день
      if (diffDays === 1) {
        // Найти МАКСИМАЛЬНЫЙ день_number среди вчерашних клеймов
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const yesterdaysClaims = claims.filter(claim => {
          const claimDate = new Date(claim.claimed_at);
          claimDate.setHours(0, 0, 0, 0);
          return claimDate.getTime() === yesterday.getTime();
        });
        
        if (yesterdaysClaims.length === 0) {
          this.logger.debug('No claims yesterday found, returning 1');
          return 1;
        }
        
        const maxYesterdayDay = Math.max(...yesterdaysClaims.map(c => c.day_number));
        const nextDay = maxYesterdayDay + 1;
        const streak = nextDay > 7 ? 1 : nextDay;
        this.logger.debug(`User ${userId} had login yesterday (max day ${maxYesterdayDay}) - returning ${streak}`);
        return streak;
      }

      // Если вход сегодня (diffDays === 0)
      // Нужно найти МАКСИМАЛЬНЫЙ день среди клеймов за СЕГОДНЯ
      if (diffDays === 0) {
        // Фильтруем только сегодняшние клеймы
        const todaysClaims = claims.filter(claim => {
          const claimDay = new Date(claim.claimed_at);
          claimDay.setHours(0, 0, 0, 0);
          return claimDay.getTime() === today.getTime();
        });

        if (todaysClaims.length === 0) {
          // Сегодня еще ничего не забирали, значит это новый день
          // Берем последний клейм (вчера или ранее) и считаем следующий день
          const nextDay = lastClaim.day_number + 1;
          const streak = nextDay > 7 ? 1 : nextDay;
          this.logger.debug(`User ${userId} no claims today yet - next day ${streak}`);
          return streak;
        } else {
          // Есть клеймы сегодня, нужно найти МАКСИМАЛЬНЫЙ день среди них
          const maxDayToday = Math.max(...todaysClaims.map(c => c.day_number));
          this.logger.debug(`User ${userId} has ${todaysClaims.length} claims today - max day is ${maxDayToday}`);
          
          // ❗ ВАЖНО: Если сегодня уже забрал награду, возвращаем тот же день
          // Следующий день будет доступен только ЗАВТРА
          // Frontend должен блокировать клейм если claimed_today = true
          this.logger.debug(`User ${userId} already claimed day ${maxDayToday} today - next claim available tomorrow`);
          return maxDayToday; // Возвращаем текущий день (не +1)
        }
      }

      // На случай если что-то прошло не так, вернем день 0
      this.logger.warn(`User ${userId} - unknown state, returning 0`);
      return 0;
    } catch (error) {
      this.logger.error('Error getting login streak', error.stack);
      return 1;
    }
  }

  /**
   * Получить все 7 дневных наград + текущий streak
   */
  async getLoginRewards(userId: string): Promise<{
    rewards: LoginRewardResponse[];
    current_streak: number;
  }> {
    if (!isUUID(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }

    // Получаем все бонусы (дни 1-7)
    const bonuses = await this.dailyBonusRepository.find({
      order: { day_number: 'ASC' },
    });

    const currentStreak = await this.getCurrentLoginStreak(userId);
    this.logger.debug(`Current streak for user ${userId}: ${currentStreak}`);

    // Для каждого дня получаем информацию о том, забрал ли пользователь награду
    const rewards: LoginRewardResponse[] = bonuses.map((bonus) => {
      const response: LoginRewardResponse = {
        day: bonus.day_number,
        title: this.getRewardTitle(bonus),
        description: this.getRewardDescription(bonus),
        reward_type: bonus.reward_type,
        claimed: false, // Пока что фиксированное значение, потом добавим проверку
      };

      if (bonus.reward_coins) {
        response.reward_coins = bonus.reward_coins;
      }
      if (bonus.boost_multiplier) {
        response.boost_multiplier = bonus.boost_multiplier;
      }
      if (bonus.boost_duration) {
        response.boost_duration = bonus.boost_duration;
      }

      return response;
    });

    // Проверяем какие награды уже забрал пользователь
    const claimedRewards = await this.userDailyClaimRepository.find({
      where: { user_id: userId },
    });

    // Проверяем какие награды были забраны сегодня
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const claimedTodayDays = new Set<number>();
    claimedRewards.forEach(claim => {
      const claimDate = new Date(claim.claimed_at);
      claimDate.setHours(0, 0, 0, 0);
      if (claimDate.getTime() === today.getTime()) {
        claimedTodayDays.add(claim.day_number);
      }
    });

    // ВАЖНО: Показываем только те награды, которые были забраны в ТЕКУЩЕМ стрике
    // Текущий стрик = последовательные дни без пропусков
    let claimedDays: Set<number> = new Set();
    
    if (claimedRewards.length > 0) {
      // Сортируем клеймы по дате (новые первые)
      const sortedClaims = [...claimedRewards].sort(
        (a, b) => new Date(b.claimed_at).getTime() - new Date(a.claimed_at).getTime()
      );

      // Собираем клеймы только из текущего стрика (consecutive дни)
      const currentStreakClaims: number[] = [];
      let checkDate = new Date();
      checkDate.setHours(0, 0, 0, 0);

      for (const claim of sortedClaims) {
        const claimDate = new Date(claim.claimed_at);
        claimDate.setHours(0, 0, 0, 0);
        
        const diffDays = Math.floor(
          (checkDate.getTime() - claimDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (diffDays <= 1) {
          // Клейм в пределах текущего стрика (сегодня или вчера от checkDate)
          currentStreakClaims.push(claim.day_number);
          checkDate = claimDate; // Переходим к дате этого клейма
        } else {
          // Найден gap > 1 дня - конец текущего стрика
          break;
        }
      }

      claimedDays = new Set(currentStreakClaims);
      this.logger.debug(`Claims in current streak: ${Array.from(claimedDays).join(', ') || 'none'}`);
    }

    const finalRewards = rewards.map((reward) => ({
      ...reward,
      claimed: claimedDays.has(reward.day),
      claimed_today: claimedTodayDays.has(reward.day), // Только для дней, забранных СЕГОДНЯ
    }));

    this.logger.debug(`Claimed days: ${Array.from(claimedDays).join(', ')}, Streak: ${currentStreak}`);
    this.logger.debug(`Returning ${finalRewards.length} rewards`);

    return {
      rewards: finalRewards,
      current_streak: currentStreak,
    };
  }

  /**
   * Забрать награду за конкретный день
   */
  async claimLoginReward(
    userId: string,
    day: number,
  ): Promise<{
    success: boolean;
    reward_type: RewardType;
    reward_coins?: number;
    boost_multiplier?: number;
    boost_duration?: number;
    message?: string;
  }> {
    if (!isUUID(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }
    
    // Проверяем валидность дня
    if (day < 1 || day > 7) {
      throw new BadRequestException('Invalid day number (1-7)');
    }

    // Получаем текущий streak
    const currentStreak = await this.getCurrentLoginStreak(userId);
    this.logger.debug(`Current streak for user ${userId}: ${currentStreak}`);

    // Проверяем не забрал ли уже СЕГОДНЯ (а не за всю историю!)
    // IMPORTANT: UNIQUE constraint защищает только от множественных клеймов В ОДИН ДЕНЬ
    // Поэтому здесь проверяем только сегодняшние клеймы
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const allUserClaims = await this.userDailyClaimRepository.find({
      where: { user_id: userId },
    });
    
    const todaysClaims = allUserClaims.filter(claim => {
      const claimDate = new Date(claim.claimed_at);
      claimDate.setHours(0, 0, 0, 0);
      return claimDate.getTime() === today.getTime();
    });
    
    // Если уже забирали что-то сегодня - блокируем
    if (todaysClaims.length > 0) {
      this.logger.debug(`User ${userId} already claimed today (day ${todaysClaims[0].day_number})`);
      throw new BadRequestException('You already claimed your daily reward today');
    }

    // Можем ли мы забрать эту награду?
    // Пользователь может забрать награду только за текущий день стрика

    // Если пользователь никогда не забирал награду, позволяем только день 1
    if (allUserClaims.length === 0) {
      if (day !== 1) {
        throw new BadRequestException('You can only claim reward for day 1');
      }
    } else {
      // Если пользователь уже забирал награды
      // Позволяем забирать только награды за дни которые соответствуют текущему стрику
      // Текущий стрик показывает за какой день можно сегодня забрать награду
      if (day !== currentStreak) {
        throw new BadRequestException(
          `You can only claim reward for day ${currentStreak}`,
        );
      }
    }

    // Получаем бонус для этого дня
    const bonus = await this.dailyBonusRepository.findOne({
      where: { day_number: day },
    });

    if (!bonus) {
      throw new NotFoundException('Bonus for this day not found');
    }

    // Сохраняем claim
    // UNIQUE constraint (user_id, claimed_at::date, day_number) protects from race condition
    const claim = this.userDailyClaimRepository.create({
      user_id: userId,
      day_number: day,
      reward_received: bonus.reward_type,
    });

    try {
      await this.userDailyClaimRepository.save(claim);
    } catch (saveError: any) {
      // Check if it's a duplicate key error (PostgreSQL code 23505)
      if (saveError.code === '23505' || saveError.message?.includes('duplicate key')) {
        this.logger.warn(`User ${userId} attempted duplicate claim (caught by UNIQUE constraint)`);
        throw new BadRequestException('You can only claim one reward per day');
      }
      // If it's a different error, rethrow it
      throw saveError;
    }

    // Update LOGIN_CLAIM task for this user
    // Find the LOGIN_CLAIM task
    const loginClaimTask = await this.taskRepository.findOne({
      where: { task_type: TaskActionType.LOGIN_CLAIM },
    });

    if (loginClaimTask) {
      const now = new Date();
      let userTask = await this.userTaskRepository.findOne({
        where: { user_id: userId, task_id: loginClaimTask.id },
      });

      if (!userTask) {
        // Create new LOGIN_CLAIM task for user
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        userTask = this.userTaskRepository.create({
          user_id: userId,
          task_id: loginClaimTask.id,
          progress: 1,
          completed: true,
          completed_at: now,
          claimed: false,  // ← User должен сам забрать reward
          reset_at: tomorrow,
        });
      } else {
        // Update existing LOGIN_CLAIM task
        const resetAt = userTask.reset_at ? new Date(userTask.reset_at) : null;

        // Check if reset is needed
        if (resetAt && now >= resetAt) {
          // Reset the task
          userTask.progress = 1;
          userTask.completed = true;
          userTask.completed_at = now;
          userTask.claimed = false;  // ← User должен сам забрать reward
          userTask.claimed_at = null;

          // Set next reset to tomorrow 00:00 UTC
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(0, 0, 0, 0);
          userTask.reset_at = tomorrow;
        } else if (!userTask.completed) {
          // Mark as completed if not already (но не claimed!)
          userTask.progress = 1;
          userTask.completed = true;
          userTask.completed_at = now;
          // claimed остается false - user должен сам забрать
        }
        // Если уже completed - ничего не меняем (user может забрать reward позже)
      }

      await this.userTaskRepository.save(userTask);
    }

    // Проверить выполнены ли ВСЕ ежедневные задачи и увеличить COMPLETE_DAILY_TASKS
    // Async check (doesn't block response)
    this.checkCompleteDailyTasksProgress(userId).catch(err => {
      this.logger.error('Error checking daily tasks', err.stack);
    });

    // Обновляем coins пользователя если это coin reward
    let updatedUser = await this.userRepository.findOne({ where: { id: userId } });
    if (!updatedUser) {
      throw new NotFoundException('User not found');
    }

    if (bonus.reward_type === RewardType.COINS && bonus.reward_coins) {
      const currentCoins = Number(updatedUser.coins) || 0;
      const rewardCoins = Number(bonus.reward_coins) || 0;
      updatedUser.coins = currentCoins + rewardCoins;
      await this.userRepository.save(updatedUser);
    }

    // Активируем бонус если это boost reward
    if (bonus.reward_type === RewardType.BOOST && bonus.boost_multiplier && bonus.boost_duration) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + bonus.boost_duration * 60 * 1000); // Конвертируем минуты в миллисекунды
      
      const boost = this.userBoostRepository.create({
        user_id: userId,
        type: BoostType.CLICK_MULTIPLIER,
        multiplier: bonus.boost_multiplier,
        activated_at: now,
        expires_at: expiresAt,
      });
      
      await this.userBoostRepository.save(boost);
      
      // Очищаем кэш бустов чтобы новый буст был загружен при следующем клике
      this.gameService.clearBoostsCache(userId);
    }

    // Обработка RANDOM награды (сундуки)
    let randomCoins = 0;
    let chestBoost: any = null;
    let weeklyTaskSkipped: any = null;
    if (bonus.reward_type === RewardType.RANDOM) {
      // Определяем тип сундука и вероятности
      const isLargeChest = bonus.random_options?.type === 'large_chest';
      
      // День 7 (большой сундук): 20% буст, 20% weekly_task_skip, 60% коины
      // День 3 (маленький сундук): 10% буст, 90% коины (без weekly_task_skip)
      const roll = Math.random();
      
      if (isLargeChest && roll < 0.2) {
        // 20% шанс на weekly task skip (только день 7)
        const incompletedWeeklyTasks = await this.taskRepository
          .createQueryBuilder('task')
          .leftJoin('task.user_tasks', 'ut', 'ut.user_id = :userId', { userId })
          .where('task.period = :period', { period: 'weekly' })
          .andWhere('task.is_active = :isActive', { isActive: true })
          .andWhere('(ut.completed IS NULL OR ut.completed = false)')
          .getMany();
        
        if (incompletedWeeklyTasks.length > 0) {
          // Случайно выбираем одно задание
          const randomTask = incompletedWeeklyTasks[Math.floor(Math.random() * incompletedWeeklyTasks.length)];
          
          // Создаем или обновляем user_task
          let userTask = await this.userTaskRepository.findOne({
            where: { user_id: userId, task_id: randomTask.id },
          });
          
          if (!userTask) {
            userTask = this.userTaskRepository.create({
              user_id: userId,
              task_id: randomTask.id,
              progress: 0,
            });
          }
          
          // Автозавершаем задание
          userTask.progress = randomTask.requirement_value;
          userTask.completed = true;
          userTask.completed_at = new Date();
          await this.userTaskRepository.save(userTask);
          
          weeklyTaskSkipped = {
            task_id: randomTask.id,
            task_name: randomTask.name,
          };
          
          this.logger.log(`Weekly task ${randomTask.name} auto-completed for user ${userId}`);
        }
      } else if (roll < (isLargeChest ? 0.4 : 0.1)) {
        // День 7: 20-40% (20%) = буст, День 3: 0-10% (10%) = буст
        const now = new Date();
        const boostDuration = isLargeChest ? 180 : 60; // День 7: 3 часа, День 3: 1 час
        const expiresAt = new Date(now.getTime() + boostDuration * 60 * 1000);
        
        chestBoost = this.userBoostRepository.create({
          user_id: userId,
          type: BoostType.CLICK_MULTIPLIER,
          multiplier: 2,
          activated_at: now,
          expires_at: expiresAt,
        });
        
        await this.userBoostRepository.save(chestBoost);
        this.gameService.clearBoostsCache(userId);
      } else {
        // Выпали коины
        let minCoins = 1000;
        let maxCoins = 10000;
        
        if (isLargeChest) {
          // День 7 - большой сундук: 10000-20000 коинов
          minCoins = 10000;
          maxCoins = 20000;
        }
        
        randomCoins = Math.floor(Math.random() * (maxCoins - minCoins + 1)) + minCoins;
        
        // Добавляем монеты пользователю
        const user = await this.userRepository.findOne({ where: { id: userId } });
        if (user) {
          const currentCoins = Number(user.coins) || 0;
          user.coins = currentCoins + randomCoins;
          await this.userRepository.save(user);
        }
      }
    }

    const response: any = {
      success: true,
      reward_type: bonus.reward_type,
      message: `Reward claimed for day ${day}`,
    };

    if (bonus.reward_coins) {
      response.reward_coins = bonus.reward_coins;
    }
    if (bonus.boost_multiplier) {
      response.boost_multiplier = bonus.boost_multiplier;
    }
    if (bonus.boost_duration) {
      response.boost_duration = bonus.boost_duration;
    }
    
    if (bonus.reward_type === RewardType.RANDOM) {
      if (weeklyTaskSkipped) {
        // Выпало автовыполнение еженедельного задания
        response.weekly_task_skip = weeklyTaskSkipped;
        response.message = `Weekly task "${weeklyTaskSkipped.task_name}" auto-completed!`;
      } else if (chestBoost) {
        // Выпал буст из сундука
        response.chest_boost = {
          multiplier: chestBoost.multiplier,
          duration: bonus.random_options?.type === 'large_chest' ? 180 : 60,
        };
        response.message = `Chest boost activated for ${response.chest_boost.duration} minutes!`;
      } else {
        // Выпали коины из сундука
        response.reward_coins = randomCoins;
        response.message = `Chest opened! ${randomCoins} coins received!`;
      }
    }

    // Логирование полученной награды
    this.logger.log(`Reward claimed successfully for user ${userId}, day ${day}, type: ${bonus.reward_type}`);

    if (bonus.reward_coins) {
      this.logger.debug(`Coins received: ${bonus.reward_coins}`);
    }
    if (bonus.boost_multiplier) {
      this.logger.debug(`Boost: ×${bonus.boost_multiplier} for ${bonus.boost_duration} minutes`);
    }
    if (bonus.reward_type === RewardType.RANDOM) {
      if (weeklyTaskSkipped) {
        this.logger.debug(`Random Chest: Weekly task "${weeklyTaskSkipped.task_name}" auto-completed`);
      } else if (chestBoost) {
        this.logger.debug(`Random Chest: Boost ×${chestBoost.multiplier} for ${response.chest_boost.duration} minutes`);
      } else {
        this.logger.debug(`Random Chest: ${randomCoins} coins`);
      }
    }
    if (bonus.reward_type === RewardType.TASK_SKIP) {
      this.logger.debug('Task Skip: User can now skip one daily task');
    }

    // Добавляем текущий баланс в ответ
    const freshUser = await this.userRepository.findOne({ where: { id: userId } });
    if (freshUser) {
      response.current_balance = freshUser.coins;
    }

    return response;
  }

  /**
   * Автоматически выполнить выбранное ежедневное задание (используется когда пользователь получает TASK_SKIP награду)
   */
  async skipDailyTask(userId: string, taskId: string): Promise<{
    success: boolean;
    message: string;
    task_id: string;
  }> {
    if (!isUUID(userId)) {
      throw new BadRequestException('Invalid user ID format');
    }
    if (!isUUID(taskId)) {
      throw new BadRequestException('Invalid task ID format');
    }

    // Получаем задачу
    const task = await this.taskRepository.findOne({
      where: { id: taskId },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // Проверяем что это ежедневное задание
    if (task.period !== TaskPeriod.DAILY) {
      throw new BadRequestException('Only daily tasks can be skipped');
    }

    // Получаем или создаем прогресс пользователя
    let userTask = await this.userTaskRepository.findOne({
      where: {
        user_id: userId, 
        task_id: taskId,
      },
    });

    // Проверяем что задание еще не выполнено
    if (userTask && userTask.completed) {
      throw new BadRequestException('This task is already completed and cannot be skipped again');
    }

    if (!userTask) {
      userTask = this.userTaskRepository.create({
        user_id: userId,
        task_id: taskId,
        progress: task.requirement_value, // Устанавливаем максимальный прогресс
        completed: true,
        completed_at: new Date(),
        claimed: false, // НЕ забираем награду! Пользователь должен нажать "Получить"
      });
    } else {
      // Обновляем существующий прогресс
      userTask.progress = task.requirement_value;
      userTask.completed = true;
      userTask.completed_at = new Date();
      // НЕ устанавливаем claimed = true! Пользователь должен нажать "Получить" чтобы забрать награду
    }

    await this.userTaskRepository.save(userTask);

    return {
      success: true,
      task_id: taskId,
      message: `Task "${task.name}" has been completed!`,
    };
  }

  /**
   * Вспомогательные методы для форматирования названий и описаний
   */
  private getRewardTitle(bonus: DailyBonus): string {
    switch (bonus.reward_type) {
      case RewardType.COINS:
        return `${bonus.reward_coins?.toLocaleString()} зубкоинов`;
      case RewardType.BOOST:
        return `Бонус ×${bonus.boost_multiplier} к тапам`;
      case RewardType.TASK_SKIP:
        return 'Автовыполнение задания';
      case RewardType.RANDOM:
        return `Сундук (День ${bonus.day_number})`;
      default:
        return 'Награда';
    }
  }

  private getRewardDescription(bonus: DailyBonus): string {
    switch (bonus.reward_type) {
      case RewardType.COINS:
        return `Награда за день ${bonus.day_number}`;
      case RewardType.BOOST:
        return `Действует ${bonus.boost_duration} минут`;
      case RewardType.TASK_SKIP:
        return 'Одно ежедневное задание на выбор';
      case RewardType.RANDOM:
        return bonus.day_number === 7
          ? '10.000–20.000 зубкоинов, бонус ×2 на 3 часа или автовыполнение еженедельного задания'
          : '1.000–10.000 зубкоинов или бонус ×2 на 1 час';
      default:
        return '';
    }
  }

  /**
   * Проверить выполнены ли ВСЕ 4 ежедневные задачи
   * Если да - увеличить прогресс COMPLETE_DAILY_TASKS
   */
  private async checkCompleteDailyTasksProgress(userId: string): Promise<void> {
    // Получить все DAILY задачи
    const dailyTasks = await this.taskRepository.find({
      where: { period: TaskPeriod.DAILY, is_active: true },
    });

    if (dailyTasks.length === 0) {
      return;
    }

    // Получить все 4 ежедневные задачи: TAPS, EARN_COINS, LOGIN_CLAIM, INVITE_FRIEND
    const dailyTaskTypes = [
      TaskActionType.TAPS,
      TaskActionType.EARN_COINS,
      TaskActionType.LOGIN_CLAIM,
      TaskActionType.INVITE_FRIEND,
    ];

    const requiredDailyTasks = dailyTasks.filter(t => dailyTaskTypes.includes(t.task_type));

    // Получить userTasks для этих ежедневных
    const userTasks = await this.userTaskRepository.find({
      where: {
        user_id: userId,
        task_id: In(requiredDailyTasks.map(t => t.id)),
      },
    });

    // Проверить все ли completed = true
    const allTasksCompleted = requiredDailyTasks.every(task =>
      userTasks.some(ut => ut.task_id === task.id && ut.completed === true)
    );

    if (allTasksCompleted) {
      // Increment COMPLETE_DAILY_TASKS progress
      await this.incrementCompleteDailyTasksProgress(userId);
    }
  }

  /**
   * Увеличить прогресс COMPLETE_DAILY_TASKS на 1
   */
  private async incrementCompleteDailyTasksProgress(userId: string): Promise<void> {
    // Найти задачу COMPLETE_DAILY_TASKS
    const completeDailyTask = await this.taskRepository.findOne({
      where: { task_type: TaskActionType.COMPLETE_DAILY_TASKS },
    });

    if (!completeDailyTask) {
      this.logger.warn('COMPLETE_DAILY_TASKS task not found');
      return;
    }

    const now = new Date();

    // Получить или создать userTask для COMPLETE_DAILY_TASKS
    let userTask = await this.userTaskRepository.findOne({
      where: { user_id: userId, task_id: completeDailyTask.id },
    });

    if (!userTask) {
      // Создать новый
      userTask = this.userTaskRepository.create({
        user_id: userId,
        task_id: completeDailyTask.id,
        progress: 1,
        completed: false,
        claimed: false,
      });
    } else {
      // Увеличить прогресс
      userTask.progress += 1;
    }

    // Проверить завершение (если progress == requirement_value)
    if (userTask.progress >= completeDailyTask.requirement_value && !userTask.completed) {
      userTask.completed = true;
      userTask.completed_at = new Date();
      this.logger.log(`User ${userId} completed COMPLETE_DAILY_TASKS`);
    }

    await this.userTaskRepository.save(userTask);
  }
}
