import { Injectable, NotFoundException, BadRequestException, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, Between } from 'typeorm';
import { Task, TaskPeriod, TaskActionType } from './entities/task.entity';
import { UserTask } from './entities/user-task.entity';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { User } from '../user/entities/user.entity';
import { UserBoost, BoostType } from '../game/entities/user-boost.entity';
import { TaskEventsService } from '../events/task-events.service';
import { ReferralService } from '../referral/referral.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);
  private completeDailyTasksLocks = new Set<string>(); // Lock для предотвращения двойных вызовов


  constructor(
    @InjectRepository(Task)
    private taskRepository: Repository<Task>,
    @InjectRepository(UserTask)
    private userTaskRepository: Repository<UserTask>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserBoost)
    private userBoostRepository: Repository<UserBoost>,
    private dataSource: DataSource,
    private taskEventsService: TaskEventsService,
    private referralService: ReferralService,
  ) {}

  /**
   * Сброс еженедельных заданий каждое воскресенье в 00:00 UTC
   * Все user_tasks с period=WEEKLY и started_at <= (now - 7 дней) будут сброшены
   */
  @Cron('0 0 * * 0', { timeZone: 'UTC' })
  async resetWeeklyTasks(): Promise<void> {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setUTCDate(now.getUTCDate() - 7);
    sevenDaysAgo.setUTCHours(now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), 0);

    // Найти все user_tasks с period=WEEKLY и started_at <= sevenDaysAgo
    const weeklyTasks = await this.taskRepository.find({ where: { period: TaskPeriod.WEEKLY, is_active: true } });
    const weeklyTaskIds = weeklyTasks.map(t => t.id);
    if (weeklyTaskIds.length === 0) return;

    const result = await this.userTaskRepository
      .createQueryBuilder()
      .update(UserTask)
      .set({
        progress: 0,
        completed: false,
        claimed: false,
        completed_at: null,
        claimed_at: null,
        started_at: now,
      })
      .where('task_id IN (:...weeklyTaskIds)', { weeklyTaskIds })
      .andWhere('started_at <= :sevenDaysAgo', { sevenDaysAgo })
      .execute();

    this.logger.log(`[resetWeeklyTasks] Сброшено weekly user_tasks: ${result.affected ?? 0} (на ${now.toISOString()})`);
  }

  /**
   * Сброс ежедневных заданий каждый день в 00:00 UTC
   * Все user_tasks с period=DAILY и reset_at <= now будут сброшены
   */
  @Cron('0 0 * * *', { timeZone: 'UTC' })
  async resetDailyTasks(): Promise<void> {
    const now = new Date();
    // Найти все daily задачи
    const dailyTasks = await this.taskRepository.find({ where: { period: TaskPeriod.DAILY, is_active: true } });
    const dailyTaskIds = dailyTasks.map(t => t.id);
    if (dailyTaskIds.length === 0) return;

    // Сбросить user_tasks, у которых reset_at <= сейчас
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(now.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);

    const result = await this.userTaskRepository
      .createQueryBuilder()
      .update(UserTask)
      .set({
        progress: 0,
        completed: false,
        claimed: false,
        completed_at: null,
        claimed_at: null,
        reset_at: tomorrow,
      })
      .where('task_id IN (:...dailyTaskIds)', { dailyTaskIds })
      .andWhere('reset_at <= :now', { now })
      .execute();

    this.logger.log(`[resetDailyTasks] Сброшено daily user_tasks: ${result.affected ?? 0} (на ${now.toISOString()})`);
  }

  // === ADMIN ENDPOINTS ===

  // Получить все задания
  async getAllTasks(): Promise<Task[]> {
    return this.taskRepository.find({
      order: { id: 'DESC' },
    });
  }

  // Получить задание по ID
  async getTaskById(id: string): Promise<Task> {
    const task = await this.taskRepository.findOne({ where: { id } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }
    return task;
  }

  // Получить задание по типу и периоду
  async getTaskByType(taskType: string, period: string = 'daily'): Promise<Task | null> {
    return this.taskRepository.findOne({ 
      where: { task_type: taskType as any, period: period as any } 
    });
  }

  // Получить ВСЕ задания по типу (независимо от периода)
  async getAllTasksByType(taskType: string): Promise<Task[]> {
    return this.taskRepository.find({
      where: { task_type: taskType as any, is_active: true },
    });
  }

  // Создать задание
  async createTask(createTaskDto: CreateTaskDto): Promise<Task> {
    const task = this.taskRepository.create(createTaskDto);
    return this.taskRepository.save(task);
  }

  // Обновить задание
  async updateTask(id: string, updateTaskDto: UpdateTaskDto): Promise<Task> {
    const task = await this.getTaskById(id);

    Object.assign(task, updateTaskDto);

    return this.taskRepository.save(task);
  }

  // Удалить задание
  async deleteTask(id: string): Promise<void> {
    const task = await this.getTaskById(id);
    await this.taskRepository.remove(task);
  }

  // === USER ENDPOINTS ===

  // Получить активные ежедневные задания
  async getDailyTasks(userId: string): Promise<any[]> {
    const tasks = await this.taskRepository.find({
      where: { period: TaskPeriod.DAILY, is_active: true },
    });

    return this.attachUserProgress(tasks, userId);
  }

  // Получить активные еженедельные задания
  async getWeeklyTasks(userId: string): Promise<any[]> {
    const tasks = await this.taskRepository.find({
      where: { period: TaskPeriod.WEEKLY, is_active: true },
    });

    return this.attachUserProgress(tasks, userId);
  }

  // Забрать награду за задание
  async claimTaskReward(userId: string, taskId: string): Promise<any> {
    const task = await this.getTaskById(taskId);
    
    // Получаем прогресс пользователя по этому заданию
    const userTask = await this.userTaskRepository.findOne({
      where: { user_id: userId, task_id: taskId },
    });

    if (!userTask) {
      throw new NotFoundException('User task progress not found');
    }

    if (!userTask.completed) {
      throw new BadRequestException('Task not completed');
    }

    if (userTask.claimed) {
      throw new BadRequestException('Task reward already claimed');
    }

    // Отмечаем как заклейменную
    userTask.claimed = true;
    userTask.claimed_at = new Date();
    await this.userTaskRepository.save(userTask);

    // Эмитим событие что награда заклеймена
    this.taskEventsService.emitTaskClaimed(userId, taskId, task.reward_coins);

    // Выдаём награду
    if (task.reward_coins > 0) {
      // Добавляем коины пользователю
      await this.dataSource
        .createQueryBuilder()
        .update(User)
        .set({
          coins: () => `coins + ${task.reward_coins}`,
          updated_at: new Date(),
        })
        .where('id = :id', { id: userId })
        .execute();
    }

    if (task.reward_boost_multiplier > 0 && task.reward_boost_duration > 0) {
      // Активируем буст
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + task.reward_boost_duration);

      const userBoost = this.userBoostRepository.create({
        user_id: userId,
        type: BoostType.CLICK_MULTIPLIER,
        multiplier: task.reward_boost_multiplier,
        expires_at: expiresAt,
        activated_at: new Date(),
      });
      await this.userBoostRepository.save(userBoost);
    }

    return {
      success: true,
      task_id: taskId,
      reward_coins: task.reward_coins,
      reward_boost_duration: task.reward_boost_duration,
      reward_boost_multiplier: task.reward_boost_multiplier,
    };
  }

  // Завершить login_claim задачу (пользователь собрал ежедневный бонус)
  async completeLoginClaimTask(userId: string): Promise<any> {
    this.logger.debug(`Completing login claim task for user ${userId}`);
    try {
      // Получаем текущую daily login_claim задачу
      const loginClaimTask = await this.taskRepository.findOne({
        where: { 
          task_type: TaskActionType.LOGIN_CLAIM,
          period: TaskPeriod.DAILY,
          is_active: true,
        },
      });

      if (!loginClaimTask) {
        throw new NotFoundException('Login claim task not found');
      }

      // Получаем или создаем прогресс пользователя по этой задаче
      let userTask = await this.userTaskRepository.findOne({
        where: { 
          user_id: userId,
          task_id: loginClaimTask.id,
        },
      });

      if (!userTask) {
        // Создаем новый прогресс (инициализируем на лету)
        userTask = this.userTaskRepository.create({
          user_id: userId,
          task_id: loginClaimTask.id,
          progress: 0,
          completed: false,
          claimed: false,
        });
      }

      // Отмечаем как completed (пользователь получил ежедневную награду)
      // НО claimed остается false - пользователь должен нажать "Получить" в ежедневных задачах
      userTask.progress = loginClaimTask.requirement_value; // progress = 1
      userTask.completed = true;
      userTask.completed_at = new Date();
      // Нe отмечаем как claimed! Награду нужно получать отдельно через claimTaskReward()

      await this.userTaskRepository.save(userTask);

      // Track the login in user_daily_claims table with proper day_number calculation
      const dailyClaimsRepository = this.dataSource.getRepository('UserDailyClaim');
      
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Calculate next day number using same logic as getCurrentLoginStreak()
        // Check if user claimed yesterday to continue streak
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayEnd = new Date(yesterday);
        yesterdayEnd.setHours(23, 59, 59, 999);

        const yesterdaysClaims = await dailyClaimsRepository.find({
          where: {
            user_id: userId,
            claimed_at: Between(yesterday, yesterdayEnd) as any,
          },
        });

        let nextDayNumber = 1;
        
        if (yesterdaysClaims.length > 0) {
          // Find MAXIMUM day_number among yesterday's claims (handles duplicates correctly)
          const maxYesterdayDay = Math.max(...yesterdaysClaims.map(c => c.day_number));
          nextDayNumber = maxYesterdayDay + 1;
          
          // Reset to day 1 after completing day 7 (full cycle)
          if (nextDayNumber > 7) {
            nextDayNumber = 1;
          }
          
          this.logger.debug(`User had login yesterday (max day ${maxYesterdayDay}) - next day: ${nextDayNumber}`);
        } else {
          // No claims yesterday - streak broken, reset to day 1
          nextDayNumber = 1;
          this.logger.debug('No claims yesterday - streak broken, resetting to day 1');
        }

        // Create new claim record with correct day_number
        // UNIQUE constraint (user_id, claimed_at::date, day_number) protects from race condition
        const newClaim = dailyClaimsRepository.create({
          user_id: userId,
          claimed_at: new Date(),
          day_number: nextDayNumber,
          reward_received: `login_day_${nextDayNumber}`,
        });
        
        try {
          await dailyClaimsRepository.save(newClaim);
          this.logger.debug(`Created day ${nextDayNumber} for user ${userId}`);
        } catch (saveError: any) {
          // Check if it's a duplicate key error (PostgreSQL code 23505)
          if (saveError.code === '23505' || saveError.message?.includes('duplicate key')) {
            this.logger.debug(`User ${userId} already claimed today (caught duplicate)`);
            return {
              success: false,
              message: 'You already claimed your daily reward today. Come back tomorrow!',
            };
          }
          // If it's a different error, rethrow it
          throw saveError;
        }
      } catch (claimError) {
        this.logger.warn('Warning saving daily claim', claimError.message);
      }

      // Calculate login streak and update weekly login_claim task (7 days streak)
      const loginStreakTask = await this.taskRepository.findOne({
        where: {
          task_type: TaskActionType.LOGIN_CLAIM,
          period: TaskPeriod.WEEKLY,
          is_active: true,
        },
      });

      if (loginStreakTask) {
        // Calculate consecutive login days
        const streak = await this.calculateLoginStreak(userId);
        
        let streakUserTask = await this.userTaskRepository.findOne({
          where: {
            user_id: userId,
            task_id: loginStreakTask.id,
          },
        });

        if (!streakUserTask) {
          streakUserTask = this.userTaskRepository.create({
            user_id: userId,
            task_id: loginStreakTask.id,
            progress: 0,
          });
        }

        streakUserTask.progress = streak;
        if (streak >= loginStreakTask.requirement_value) {
          streakUserTask.completed = true;
          streakUserTask.completed_at = new Date();
        }

        await this.userTaskRepository.save(streakUserTask);
      }

      // Эмитим событие что задача completed (но НЕ claimed!)
      this.taskEventsService.emitTaskCompleted(userId, loginClaimTask.id);

      // Get the day_number that was just claimed
      const justClaimed = await dailyClaimsRepository
        .createQueryBuilder('udc')
        .where('udc.user_id = :userId', { userId })
        .orderBy('udc.claimed_at', 'DESC')
        .take(1)
        .getOne();

      const currentDayNumber = justClaimed?.day_number || 1;

      return {
        success: true,
        task_id: loginClaimTask.id,
        day_number: currentDayNumber,
        claimed_at: justClaimed?.claimed_at || new Date(), // Frontend знает когда был клайм
        message: `Day ${currentDayNumber} marked! Daily login streak: ${currentDayNumber}/7 days`,
        reward_info: {
          coins: loginClaimTask.reward_coins,
          boost_duration: loginClaimTask.reward_boost_duration,
          boost_multiplier: loginClaimTask.reward_boost_multiplier,
        },
      };
    } catch (error) {
      this.logger.error('Error in completeLoginClaimTask', error.stack);
      throw error;
    }
  }

  // === HELPER METHODS ===

  // Calculate consecutive login streak for a user
  // Возвращает ТЕКУЩИЙ ДЕНЬ в стрике (не last claimed day, а следующий доступный)
  private async calculateLoginStreak(userId: string): Promise<number> {
    try {
      const dailyClaimsRepository = this.dataSource.getRepository('UserDailyClaim');
      
      // Get all claims to calculate consecutive days
      const claims = await dailyClaimsRepository
        .createQueryBuilder('udc')
        .where('udc.user_id = :userId', { userId })
        .orderBy('udc.claimed_at', 'DESC')
        .getMany();

      if (claims.length === 0) {
        return 1; // No claims - day 1 available
      }

      const lastClaim = claims[0];
      const lastClaimDate = new Date(lastClaim.claimed_at);
      lastClaimDate.setHours(0, 0, 0, 0);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      const diffTime = today.getTime() - lastClaimDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

      // Streak broken if more than 1 day gap
      if (diffDays > 1) {
        return 1; // Reset to day 1
      }

      // If claimed yesterday, count consecutive days and return NEXT available day
      if (diffDays === 1) {
        const yesterdaysClaims = claims.filter(claim => {
          const claimDate = new Date(claim.claimed_at);
          claimDate.setHours(0, 0, 0, 0);
          return claimDate.getTime() === yesterday.getTime();
        });
        
        if (yesterdaysClaims.length > 0) {
          const maxYesterdayDay = Math.max(...yesterdaysClaims.map(c => c.day_number));
          const nextDay = maxYesterdayDay + 1;
          return nextDay > 7 ? 1 : nextDay; // Return NEXT day
        }
        return 1;
      }

      // If claimed today, return current day (same as today's max day)
      if (diffDays === 0) {
        const todaysClaims = claims.filter(claim => {
          const claimDate = new Date(claim.claimed_at);
          claimDate.setHours(0, 0, 0, 0);
          return claimDate.getTime() === today.getTime();
        });

        if (todaysClaims.length > 0) {
          const maxDayToday = Math.max(...todaysClaims.map(c => c.day_number));
          return maxDayToday; // Return current day count
        }
        
        // No claims today yet - calculate next day
        const nextDay = lastClaim.day_number + 1;
        return nextDay > 7 ? 1 : nextDay;
      }

      return 1;
    } catch (error) {
      this.logger.error('Error calculating login streak', error.stack);
      return 1;
    }
  }

  private async attachUserProgress(tasks: Task[], userId: string): Promise<any[]> {
    const userTasks = await this.userTaskRepository.find({ where: { user_id: userId } });
    const userTaskMap = new Map(userTasks.map((ut) => [ut.task_id, ut]));
    const now = new Date();
    const results: any[] = [];

    // Получаем счетчики рефералов для заданий
    const referralCounts = await this.referralService.getTaskReferralCounts(userId);

    // Используем транзакцию для атомарности сброса
    const queryRunner = this.userTaskRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      for (const task of tasks) {
        let userTask = userTaskMap.get(task.id);
        let resetAt: Date | null = null;
        let startedAt: Date | null = null;
        
        // Для задач invite_friend берем прогресс из ReferralService
        let actualProgress = userTask?.progress || 0;
        if (task.task_type === TaskActionType.INVITE_FRIEND) {
          if (task.period === TaskPeriod.DAILY) {
            actualProgress = referralCounts.dailyInvitedFriends;
          } else if (task.period === TaskPeriod.WEEKLY) {
            actualProgress = referralCounts.weeklyInvitedFriends;
          }
          // Обновляем user_task если прогресс изменился
          if (userTask && actualProgress !== userTask.progress) {
            userTask.progress = actualProgress;
            userTask.completed = actualProgress >= task.requirement_value;
            if (userTask.completed && !userTask.completed_at) {
              userTask.completed_at = new Date();
            }
            await queryRunner.manager.save(userTask);
          }
        }

        // Для еженедельной задачи login_claim автоматически обновляем прогресс из streak
        if (task.task_type === TaskActionType.LOGIN_CLAIM && task.period === TaskPeriod.WEEKLY) {
          const currentStreak = await this.calculateLoginStreak(userId);
          actualProgress = currentStreak;
          
          if (userTask && actualProgress !== userTask.progress) {
            userTask.progress = actualProgress;
            userTask.completed = actualProgress >= task.requirement_value;
            if (userTask.completed && !userTask.completed_at) {
              userTask.completed_at = new Date();
            }
            await queryRunner.manager.save(userTask);
          }
        }

        // DAILY
        if (task.period === TaskPeriod.DAILY) {
          if (userTask) {
            resetAt = userTask.reset_at ? new Date(userTask.reset_at) : null;
            if (!resetAt) {
              const tomorrow = new Date(now);
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(0, 0, 0, 0);
              resetAt = tomorrow;
              userTask.reset_at = resetAt;
              await queryRunner.manager.save(userTask);
              this.logger.debug(`Initialized reset_at for userTask ${userTask.id}`);
            }
            if (now >= resetAt) {
              userTask.progress = 0;
              userTask.completed = false;
              userTask.claimed = false;
              userTask.completed_at = null;
              userTask.claimed_at = null;
              const tomorrow = new Date(now);
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(0, 0, 0, 0);
              userTask.reset_at = tomorrow;
              await queryRunner.manager.save(userTask);
              this.logger.debug(`Reset daily userTask ${userTask.id}`);
            }
          } else {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            resetAt = tomorrow;
          }
        }

        // WEEKLY
        if (task.period === TaskPeriod.WEEKLY) {
          if (userTask) {
            startedAt = userTask.started_at ? new Date(userTask.started_at) : null;
            // Не инициализируем started_at при чтении! Только читаем.
            const sevenDaysLater = startedAt ? new Date(startedAt) : null;
            if (sevenDaysLater) {
              sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
              if (now >= sevenDaysLater) {
                userTask.progress = 0;
                userTask.completed = false;
                userTask.claimed = false;
                userTask.completed_at = null;
                userTask.claimed_at = null;
                userTask.started_at = now;
                await queryRunner.manager.save(userTask);
                this.logger.debug(`Reset weekly userTask ${userTask.id}`);
              }
            }
          }
        }

        const result = {
          ...task,
          completed: userTask?.completed || false,
          claimed: userTask?.claimed || false,
          progress: actualProgress,
          reset_at: resetAt || userTask?.reset_at || null,
          started_at: startedAt || userTask?.started_at || null,
          user_progress: {
            progress: actualProgress,
            requirement_value: task.requirement_value,
            completed: userTask?.completed || false,
            claimed: userTask?.claimed || false,
            completion_percentage: userTask
              ? Math.min(100, (userTask.progress / task.requirement_value) * 100)
              : 0,
          },
        };
        results.push(result);
      }
      await queryRunner.commitTransaction();
      // this.logger.log(`attachUserProgress: сброс и инициализация user_tasks завершены успешно для userId=${userId}`);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      this.logger.error('attachUserProgress: ошибка сброса/инициализации user_tasks', err.stack);
      throw err;
    } finally {
      await queryRunner.release();
    }
    return results;
  }

  // Обновить прогресс пользователя (вызывается из других сервисов)
  async updateUserTaskProgress(
    userId: string,
    taskId: string,
    progressDelta: number,
  ): Promise<void> {
    const delta = Number(progressDelta) || 0;
    // Ограничение на максимальное значение delta (например, 100)
    const MAX_DELTA = 100;
    if (delta <= 0) return;
    if (delta > MAX_DELTA) {
      throw new BadRequestException(`progressDelta (${delta}) превышает максимально допустимое значение (${MAX_DELTA})`);
    }
    
    const task = await this.getTaskById(taskId);
    
    // Skip progress update for inactive tasks
    if (!task.is_active) {
      this.logger.debug(`Task ${taskId} is inactive - skipping progress update for user ${userId}`);
      return;
    }
    
    const now = new Date();
    let userTask = await this.userTaskRepository.findOne({
      where: { user_id: userId, task_id: taskId },
    });

    // Case 1: New task - create and save
    if (!userTask) {
      userTask = this.userTaskRepository.create({
        user_id: userId,
        task_id: taskId,
        progress: delta as any,
        completed: delta >= task.requirement_value,
        claimed: false,
      });

      // Set reset_at for daily tasks
      if (task.period === TaskPeriod.DAILY) {
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        userTask.reset_at = tomorrow;
      }

      if (userTask.completed) {
        userTask.completed_at = new Date();
      }

      await this.userTaskRepository.save(userTask);
      
      // Эмитим событие если задача завершена
      if (userTask.completed) {
        this.taskEventsService.emitTaskCompleted(userId, taskId);
      }
      
      // Check COMPLETE_DAILY_TASKS if daily task just completed
      if (userTask.completed && task.period === TaskPeriod.DAILY) {
        this.checkCompleteDailyTasksProgress(userId).catch(err => {
          this.logger.error('Error checking daily tasks', err.stack);
        });
      }
      return;
    }

    // Case 2: Existing task - check if needs reset

    // Case 3: Add to existing progress (atomic update to prevent race conditions)
    const wasCompleted = userTask.completed;
    
    // Use atomic UPDATE to prevent race conditions on fast clicks
    await this.userTaskRepository
      .createQueryBuilder()
      .update(UserTask)
      .set({
        progress: () => `progress + ${delta}`,
        completed: () => `CASE 
          WHEN progress + ${delta} >= ${task.requirement_value} THEN true 
          ELSE completed 
        END`,
        completed_at: () => `CASE 
          WHEN progress + ${delta} >= ${task.requirement_value} AND completed = false THEN NOW() 
          ELSE completed_at 
        END`,
      })
      .where('user_id = :userId AND task_id = :taskId', { userId, taskId })
      .execute();

    // Re-fetch to check if task was just completed
    const updatedTask = await this.userTaskRepository.findOne({
      where: { user_id: userId, task_id: taskId },
    });

    const isNowCompleted = !wasCompleted && updatedTask?.completed;

    // Эмитим событие если задача завершена
    if (isNowCompleted) {
      this.taskEventsService.emitTaskCompleted(userId, taskId);
    }

    // Check COMPLETE_DAILY_TASKS if daily task just completed
    if (isNowCompleted && task.period === TaskPeriod.DAILY) {
      this.checkCompleteDailyTasksProgress(userId).catch(err => {
        this.logger.error('Error checking daily tasks', err.stack);
      });
    }
  }

  /**
   * Проверить выполнены ли ВСЕ 4 ежедневные задачи
   * Если да - увеличить прогресс COMPLETE_DAILY_TASKS
   */
  private async checkCompleteDailyTasksProgress(userId: string): Promise<void> {
    // Защита от одновременных вызовов для одного пользователя
    if (this.completeDailyTasksLocks.has(userId)) {
      this.logger.debug(`Already checking daily tasks for user ${userId}, skipping duplicate call`);
      return;
    }

    this.completeDailyTasksLocks.add(userId);
    
    try {
      // Получить все 4 DAILY задачи
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
    } finally {
      // Всегда освобождаем lock
      this.completeDailyTasksLocks.delete(userId);
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

  /**
   * Инициализация задач для нового пользователя
   * Создает записи userTasks для всех активных ежедневных и еженедельных задач
   */
  async initializeTasksForUser(userId: string): Promise<void> {
    try {
      // Получаем все активные задачи
      const allTasks = await this.taskRepository.find({
        where: { is_active: true },
      });

      const now = new Date();
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      // Создаем userTasks для каждой задачи
      const userTasksToCreate = allTasks.map(task => {
        const userTask = this.userTaskRepository.create({
          user_id: userId, 
          task_id: task.id,
          progress: 0,
          completed: false,
          claimed: false,
        });

        // Устанавливаем reset_at для ежедневных задач
        if (task.period === TaskPeriod.DAILY) {
          userTask.reset_at = tomorrow;
        }

        return userTask;
      });

      // Сохраняем все в БД
      await this.userTaskRepository.save(userTasksToCreate);
      this.logger.log(`Initialized ${userTasksToCreate.length} tasks for user ${userId}`);
    } catch (error) {
      this.logger.error(`Error initializing tasks for user ${userId}`, error.stack);
      // Не бросаем ошибку - это не критично для создания пользователя
    }
  }
}
