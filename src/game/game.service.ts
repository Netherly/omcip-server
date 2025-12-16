import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, MoreThan } from 'typeorm';
import { User } from '../user/entities/user.entity';
import { UserBoost } from './entities/user-boost.entity';
import { UserUpgrade } from './entities/user-upgrade.entity';
import { IGameState, IClickResult, IActiveBoost } from './interfaces/game-state.interface';
import { ClickDto } from './dto/click.dto';
import { RedisService } from '../redis/redis.service';
import { TasksService } from '../tasks/tasks.service';
import { GAME_CONFIG } from '../config/game.config';

@Injectable()
export class GameService implements OnModuleInit {
  private boostsCache = new Map<string, { boosts: IActiveBoost[]; expiresAt: number }>();
  
  // In-memory энергия кэш: userId -> { energy, lastUpdateAt, lastSyncAt }
  private energyCache = new Map<string, { 
    energy: number; 
    lastUpdateAt: number; 
    lastSyncAt: number;
    maxEnergy: number;
    regenRate: number;
  }>();

  // Rate limiting на клики: userId -> clickTimestamps[]
  private clickRateLimiter = new Map<string, number[]>();
  
  // Кэш IDs задач для обновления прогресса (может быть несколько для каждого типа)
  private taskIds: { 
    taps: string[]; 
    earn_coins: string[]; 
  } = {
    taps: [],
    earn_coins: [],
  };
  
  // Интервал синхронизации энергии с БД (в миллисекундах)
  private readonly ENERGY_SYNC_INTERVAL = GAME_CONFIG.ENERGY_SYNC_INTERVAL_MS;
  
  // Rate limit: макс кликов в секунду на пользователя
  private readonly MAX_CLICKS_PER_SECOND = GAME_CONFIG.CLICK_RATE_LIMIT.MAX_CLICKS_PER_SECOND;
  private readonly RATE_LIMIT_WINDOW = GAME_CONFIG.CLICK_RATE_LIMIT.WINDOW_MS;
  
  // Auto-clicker constants
  private readonly AUTO_CLICKER_MAX_OFFLINE_SECONDS = GAME_CONFIG.AUTO_CLICKER_MAX_OFFLINE_SECONDS;
  
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserBoost)
    private userBoostRepository: Repository<UserBoost>,
    @InjectRepository(UserUpgrade)
    private userUpgradeRepository: Repository<UserUpgrade>,
    private dataSource: DataSource,
    private redisService: RedisService,
    private tasksService: TasksService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.initializeTaskIds();
  }

  // Инициализировать кэш IDs задач
  private async initializeTaskIds(): Promise<void> {
    try {
      // Получаем ВСЕ задачи типа 'taps' (и daily, и weekly)
      const tapsTasks = await this.tasksService.getAllTasksByType('taps');
      if (tapsTasks && tapsTasks.length > 0) {
        this.taskIds.taps = tapsTasks.map(t => t.id);
      }

      // Получаем ВСЕ задачи типа 'earn_coins' (и daily, и weekly)
      const earnCoinsTasks = await this.tasksService.getAllTasksByType('earn_coins');
      if (earnCoinsTasks && earnCoinsTasks.length > 0) {
        this.taskIds.earn_coins = earnCoinsTasks.map(t => t.id);
      }
    } catch (error) {
      console.warn('[Game] Warning: Failed to initialize task IDs:', error);
    }
  }

  // Очистить кэш бустов для пользователя (используется когда новый буст активирован)
  clearBoostsCache(userId: string): void {
    this.boostsCache.delete(userId);
  }

  // Получить текущее состояние игры
  async getGameState(userId: string): Promise<IGameState> {
    // Синхронизируем энергию если нужно
    if (this.needsSync(userId)) {
      await this.syncEnergyWithDb(userId);
    }

    // Пытаемся получить из кэша
    let currentEnergy = this.getCachedEnergy(userId);

    // Загружаем полного пользователя со всеми связанными сущностями один раз
    // БЕЗ tasks - будем загружать их отдельно через TasksService
    let user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['upgrades', 'services'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Если энергия не в кэше, вычисляем её
    if (currentEnergy === null) {
      currentEnergy = this.calculateCurrentEnergy(user);
      this.setCachedEnergy(userId, currentEnergy, user);
    } else {
      // Обновляем последние данные в кэше
      this.setCachedEnergy(userId, currentEnergy, user);
    }

    // ETAPE 4: Применяем offline earnings от auto-clicker'а если они есть
    try {
      const autoClickerLevel = await this.getAutoClickerLevel(userId);
      if (autoClickerLevel > 0) {
        // Auto-clicker config
        const autoClickerConfig = {
          1: { coinsPerHour: 1000 },
          2: { coinsPerHour: 1500 },
          3: { coinsPerHour: 2500 },
          4: { coinsPerHour: 4000 },
          5: { coinsPerHour: 6000 },
        };

        // Суммируем доход от всех уровней с 1 по текущий
        let totalCoinsPerHour = 0;
        for (let i = 1; i <= autoClickerLevel; i++) {
          totalCoinsPerHour += autoClickerConfig[i].coinsPerHour;
        }

        const offlineEarnings = await this.calculateOfflineEarnings(userId, totalCoinsPerHour);

        if (offlineEarnings > 0) {
          // Применяем earnings и обновляем последнее время активности
          const newCoins = await this.applyOfflineEarnings(userId, offlineEarnings);
          await this.resetLastActiveTime(userId);

          // Перезагружаем user object для возврата
          user = await this.userRepository.findOne({
            where: { id: userId },
            relations: ['upgrades', 'services'],
          });

          if (!user) {
            throw new NotFoundException('User not found after applying offline earnings');
          }
        }
      }
    } catch (error) {
      console.error(`[AutoClicker] Error applying offline earnings for user ${userId}:`, error);
      // Не прерываем getGameState если ошибка в offline earnings
    }

    // Проверяем что user все еще существует
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Получаем активные бусты
    const activeBoosts = await this.getActiveBoosts(userId);

    // Рассчитываем base_coins_per_click (для UI и будущих кликов)
    // Это базовое значение без бустов
    const baseCoinsPerClick = await this.calculateBaseCoinsPerClick(userId);

    // Загружаем задачи через TasksService чтобы получить правильные данные с прогрессом
    const dailyTasks = await this.tasksService.getDailyTasks(userId);
    const weeklyTasks = await this.tasksService.getWeeklyTasks(userId);
    const allTasks = [...dailyTasks, ...weeklyTasks];

    return {
      user: {
        id: user.id,
        telegram_id: user.telegram_id,
        username: user.username,
        first_name: user.first_name,
        coins: user.coins,
        energy: currentEnergy,
        max_energy: user.max_energy,
        energy_regen_rate: user.energy_regen_rate,
        click_power: user.click_power,
        level: user.level,
        experience: user.experience,
        total_taps: user.total_taps,
        base_coins_per_click: baseCoinsPerClick,
        upgrades: user.upgrades || [],
        services: user.services || [],
        tasks: allTasks,
        // daily_claims не используется на фронтенде - убрано для оптимизации
      },
      user_services: user.services || [],
      activeBoosts,
      serverTime: new Date(),
    };
  }

  // Обработка кликов
  async handleClick(userId: string, clickDto: ClickDto): Promise<IClickResult> {
    try {
      const { clicks = 1, timestamps = [Date.now()], coinsPerClick = 1 } = clickDto || {};

      // 0. Валидация количества кликов
      if (clicks < 1 || clicks > this.MAX_CLICKS_PER_SECOND) {
        throw new BadRequestException(
          `Неверное количество кликов. Допустимо: 1-${this.MAX_CLICKS_PER_SECOND}`,
        );
      }

      // 1. Rate limiting проверка
      if (!this.checkClickRateLimit(userId)) {
        throw new ForbiddenException(
          `Слишком много кликов. Макс: ${this.MAX_CLICKS_PER_SECOND} клик(ов) в секунду`,
        );
      }

      // 2. Валидация (античит)
      this.validateClicks(clicks, timestamps);

      // 2. Синхронизируем энергию с БД если нужно
      if (this.needsSync(userId)) {
        await this.syncEnergyWithDb(userId);
      }

      // 3. Получаем текущее состояние пользователя из БД (источник истины)
      const user = await this.userRepository.findOne({
        where: { id: userId },
      });

      if (!user) {
        throw new NotFoundException('User not found');
      }

      // Вычисляем текущую энергию с учетом регенерации
      const currentEnergy = this.calculateCurrentEnergy(user);

      // 4. Получаем активные бусты
      const activeBoosts = await this.getActiveBoosts(userId);
      const multiplier = this.calculateMultiplier(activeBoosts);

      // 5. Рассчитываем энергию которую нужно потратить
      const energyPerClick = Math.min(coinsPerClick * multiplier, 10);
      const totalEnergyNeeded = clicks * energyPerClick;

      // 6. Считаем награду
      const coinsEarned = Math.floor(clicks * coinsPerClick * multiplier);
      const experienceEarned = Math.floor(clicks * coinsPerClick * multiplier);
      const energySpent = totalEnergyNeeded;
      
      // 7. Атомарно обновляем БД с проверкой энергии в WHERE
      // Это предотвращает race condition - если энергии недостаточно, строка не обновится
      const newEnergyValue = currentEnergy - energySpent;
      
      const result = await this.dataSource
        .createQueryBuilder()
        .update(User)
        .set({
          coins: () => `coins + ${coinsEarned}`,
          energy: newEnergyValue,
          total_taps: () => `total_taps + ${clicks}`,
          experience: () => `experience + ${experienceEarned}`,
          last_click_at: new Date(),
          last_energy_update: new Date(),
          updated_at: new Date(),
        })
        .where('id = :id AND energy >= :minEnergy', { 
          id: userId, 
          minEnergy: totalEnergyNeeded 
        })
        .returning('*')
        .execute();

      // Если не обновлено ни одной строки - недостаточно энергии
      if (!result.affected || result.affected === 0) {
        throw new BadRequestException(
          `Недостаточно энергии. Требуется: ${totalEnergyNeeded}`,
        );
      }

      if (!result.raw || !result.raw[0]) {
        console.error('[Game] ERROR: result.raw is empty or undefined', { result });
        throw new Error('Failed to update user: no data returned from database');
      }

      const updatedUser = result.raw[0];

      // 8. Обновляем кэш энергии после успешного обновления БД
      this.energyCache.set(userId, {
        energy: newEnergyValue,
        lastUpdateAt: Date.now(),
        lastSyncAt: Date.now(),
        maxEnergy: updatedUser.max_energy,
        regenRate: updatedUser.energy_regen_rate,
      });

      // 10. Обновляем время последней активности в Redis для auto-clicker'а
      await this.updateLastActiveTime(userId);

      // 11. Проверяем повышение уровня (БЕЗ доп SELECT - вычисляем локально)
      const newLevel = this.calculateLevel(updatedUser.experience);
      if (newLevel !== updatedUser.level) {
        await this.userRepository.update(
          { id: userId },
          { level: newLevel },
        );
      }

      // Обновляем прогресс задач (синхронно с await для надежности)
      // Обновляем ВСЕ задачи типа 'taps' (и daily, и weekly)
      if (this.taskIds.taps && this.taskIds.taps.length > 0) {
        for (const taskId of this.taskIds.taps) {
          try {
            await this.tasksService.updateUserTaskProgress(userId, taskId, clicks);
          } catch (error) {
            console.error('[Game] Error: Failed to update TAPS task progress:', error);
            // Продолжаем выполнение даже если одна задача не обновилась
          }
        }
      }
      
      // Обновляем ВСЕ задачи типа 'earn_coins' (и daily, и weekly)
      if (this.taskIds.earn_coins && this.taskIds.earn_coins.length > 0) {
        for (const taskId of this.taskIds.earn_coins) {
          try {
            await this.tasksService.updateUserTaskProgress(userId, taskId, coinsEarned);
          } catch (error) {
            console.error('[Game] Error: Failed to update EARN_COINS task progress:', error);
            // Продолжаем выполнение даже если одна задача не обновилась
          }
        }
      }

      return {
        success: true,
        coins: updatedUser.coins,
        energy: newEnergyValue,
        total_taps: updatedUser.total_taps,
        earned: coinsEarned,
        currentMultiplier: multiplier,
      };
    } catch (error) {
      console.error('[Game] Error in handleClick:', error);
      throw error;
    }
  }

  /**
   * Добавить монеты от автокликера (вызывается каждые N сек, когда пользователь онлайн)
   */
  async addAutoClickerEarnings(userId: string): Promise<{ coins: number; earned: number } | null> {
    try {
      const autoClickerLevel = await this.getAutoClickerLevel(userId);
      
      // Если нет автокликера - ничего не добавляем
      if (autoClickerLevel === 0) {
        return null;
      }

      // Auto-clicker config
      const autoClickerConfig = {
        1: { coinsPerHour: 1000 },
        2: { coinsPerHour: 1500 },
        3: { coinsPerHour: 2500 },
        4: { coinsPerHour: 4000 },
        5: { coinsPerHour: 6000 },
      };

      // Суммируем доход от всех уровней с 1 по текущий
      let totalCoinsPerHour = 0;
      for (let i = 1; i <= autoClickerLevel; i++) {
        totalCoinsPerHour += autoClickerConfig[i].coinsPerHour;
      }

      // Расчет за 10 секунд (интервал вызова)
      const coinsToAdd = Math.floor((totalCoinsPerHour / 3600) * 10);

      if (coinsToAdd <= 0) {
        return null;
      }

      // Добавляем монеты в БД
      const result = await this.dataSource
        .createQueryBuilder()
        .update(User)
        .set({
          coins: () => `coins + ${coinsToAdd}`,
          updated_at: new Date(),
        })
        .where('id = :id', { id: userId })
        .returning('coins')
        .execute();

      const newCoins = result.raw?.[0]?.coins || 0;

      return {
        coins: newCoins,
        earned: coinsToAdd,
      };
    } catch (error) {
      console.error(`[AutoClicker] Error adding earnings for user ${userId}:`, error);
      return null;
    }
  }

  // Рассчет текущей энергии с учетом восстановления
  private calculateCurrentEnergy(user: User): number {
    const now = new Date();
    const lastUpdate = user.last_click_at || user.updated_at;
    const secondsSinceUpdate = (now.getTime() - lastUpdate.getTime()) / 1000;
    const recoveredEnergy = Math.floor(secondsSinceUpdate * user.energy_regen_rate);

    return Math.min(user.energy + recoveredEnergy, user.max_energy);
  }

  // Получить кэшированную энергию с расчетом восстановления
  private getCachedEnergy(userId: string): number | null {
    const cached = this.energyCache.get(userId);
    if (!cached) {
      return null;
    }

    const now = Date.now();
    const secondsSinceUpdate = (now - cached.lastUpdateAt) / 1000;
    const recoveredEnergy = Math.floor(secondsSinceUpdate * cached.regenRate);
    const currentEnergy = Math.min(cached.energy + recoveredEnergy, cached.maxEnergy);

    return currentEnergy;
  }

  // Обновить кэш энергии
  private setCachedEnergy(userId: string, energy: number, user: User): void {
    const now = Date.now();
    this.energyCache.set(userId, {
      energy,
      lastUpdateAt: now,
      lastSyncAt: now,
      maxEnergy: user.max_energy,
      regenRate: user.energy_regen_rate,
    });
  }

  // Проверить нужна ли синхронизация с БД
  private needsSync(userId: string): boolean {
    const cached = this.energyCache.get(userId);
    if (!cached) {
      return true; // Нет в кэше, нужна синхронизация
    }

    const now = Date.now();
    return now - cached.lastSyncAt > this.ENERGY_SYNC_INTERVAL;
  }

  // Синхронизировать энергию с БД
  private async syncEnergyWithDb(userId: string): Promise<void> {
    try {
      const user = await this.userRepository.findOne({
        where: { id: userId },
      });

      if (user) {
        const currentEnergy = this.calculateCurrentEnergy(user);
        this.setCachedEnergy(userId, currentEnergy, user);
      }
    } catch (error) {
      console.error(`[GameService] Failed to sync energy for user ${userId}:`, error.message);
    }
  }

  // Получить энергию ТОЛЬКО из кэша без запроса к БД
  // Используется для WebSocket энергия обновлений
  public getEnergyFromCache(userId: string): { energy: number; max_energy: number } | null {
    const cached = this.energyCache.get(userId);
    if (!cached) {
      return null;
    }

    const now = Date.now();
    const secondsSinceUpdate = (now - cached.lastUpdateAt) / 1000;
    const recoveredEnergy = Math.floor(secondsSinceUpdate * cached.regenRate);
    const currentEnergy = Math.min(cached.energy + recoveredEnergy, cached.maxEnergy);

    return {
      energy: currentEnergy,
      max_energy: cached.maxEnergy,
    };
  }

  // Проверить rate limit на клики
  private checkClickRateLimit(userId: string): boolean {
    const now = Date.now();
    let timestamps = this.clickRateLimiter.get(userId) || [];

    // Удаляем клики старше 1 секунды
    timestamps = timestamps.filter(ts => now - ts < this.RATE_LIMIT_WINDOW);

    // Проверяем лимит
    if (timestamps.length >= this.MAX_CLICKS_PER_SECOND) {
      return false;
    }

    // Добавляем текущий клик
    timestamps.push(now);
    this.clickRateLimiter.set(userId, timestamps);

    return true;
  }

  // Валидация кликов (античит)
  private validateClicks(clicks: number, timestamps: number[]): void {
    if (!timestamps || timestamps.length === 0) {
      // Если timestamps пуст - используем текущее время
      return;
    }
    
    if (timestamps.length !== clicks) {
      throw new BadRequestException('Количество timestamps не совпадает с clicks');
    }

    // Проверка временных меток
    const now = Date.now();
    for (const timestamp of timestamps) {
      // Timestamp не может быть в будущем
      if (timestamp > now + 1000) {
        throw new ForbiddenException('Невалидный timestamp (будущее)');
      }

      // Timestamp не может быть слишком старым (более 10 секунд)
      if (now - timestamp > 10000) {
        throw new ForbiddenException('Невалидный timestamp (слишком старый)');
      }
    }

    // Проверка скорости кликов
    if (clicks > 1) {
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b);
      const timeDiff = sortedTimestamps[sortedTimestamps.length - 1] - sortedTimestamps[0];
      const avgClickSpeed = timeDiff / (clicks - 1);

      // Минимум 50мс между кликами (20 кликов в секунду максимум)
      if (avgClickSpeed < 50) {
        throw new ForbiddenException(
          `Слишком быстрые клики. Средняя скорость: ${avgClickSpeed.toFixed(1)}мс`,
        );
      }
    }
  }

  // Получить активные бусты из БД
  private async getActiveBoosts(userId: string): Promise<IActiveBoost[]> {
    const now = Date.now();
    
    // Проверяем кэш (только если есть бусты в кэше)
    const cached = this.boostsCache.get(userId);
    if (cached && cached.expiresAt > now && cached.boosts.length > 0) {
      // Кэш ещё актуален и содержит бусты, возвращаем закэшированные бусты
      return cached.boosts;
    }
    
    // Кэша нет или он истёк, загружаем из БД (или кэш пуст - нужно перепроверить)
    // КРИТИЧНО: используем raw query с UTC сравнением, чтобы избежать проблем с часовыми поясами
    
    // Получаем expires_at как numeric timestamp (миллисекунды с epoch) вместо Date string
    // Это избегает проблем с интерпретацией timezone в TypeORM/Node.js
    const boosts = await this.userBoostRepository.query(
      `SELECT "id", "user_id", "type", "multiplier", "activated_at",
              EXTRACT(EPOCH FROM "expires_at" AT TIME ZONE 'UTC') * 1000 as expires_at_ms
       FROM "user_boosts"
       WHERE "user_id" = $1 AND "expires_at" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`,
      [userId]
    );

    const activeBoosts = boosts.map((boost) => {
      // expires_at_ms уже в миллисекундах UTC от PostgreSQL
      // Это избегает любых timezone conversion issues
      const expiresAtMs = Number(boost.expires_at_ms);
      
      return {
        type: boost.type,
        multiplier: Number(boost.multiplier),
        endsAt: new Date(expiresAtMs),
        remainingSeconds: Math.ceil(
          (expiresAtMs - now) / 1000,
        ),
        expiresAtMs, // Добавляем для использования при кэшировании
      };
    });
    
    // Кэшируем до момента истечения самого раннего буста
    if (activeBoosts.length > 0) {
      // Находим самый ранний expiration time среди всех бустов
      const earliestExpiry = Math.min(...activeBoosts.map(b => b.expiresAtMs));
      
      this.boostsCache.set(userId, {
        boosts: activeBoosts,
        expiresAt: earliestExpiry, // Кэш живет до истечения буста
      });
    } else {
      // Если бустов нет, кэшируем "пустое" состояние на 30 секунд
      // чтобы не делать лишние запросы к БД
      this.boostsCache.set(userId, {
        boosts: [],
        expiresAt: now + 30000, // 30 секунд для состояния "нет бустов"
      });
      // Очищаем кэш если бустов нет
      this.boostsCache.delete(userId);
    }
    
    return activeBoosts;
  }

  // Рассчитать базовый бонус за клик от всех купленных апгрейдов
  private async calculateBaseCoinsPerClick(userId: string): Promise<number> {
    try {
      // Получаем все купленные апгрейды пользователя
      const userUpgrades = await this.userUpgradeRepository.find({
        where: { user_id: userId as any },
      });

      if (!userUpgrades || userUpgrades.length === 0) {
        return 1; // базовый бонус
      }

      // Получаем все доступные апгрейды с их стоимостью
      const upgrades = await this.dataSource.query(
        `SELECT id, name, base_value FROM upgrades WHERE is_active = true`
      );

      // Суммируем бонусы от всех купленных апгрейдов
      let totalBonus = 1; // начальный бонус
      
      userUpgrades.forEach(userUpgrade => {
        const upgradeData = upgrades.find((u: any) => u.id === userUpgrade.upgrade_id);
        if (upgradeData && upgradeData.base_value) {
          const bonus = parseFloat(upgradeData.base_value) || 0;
          totalBonus += bonus;
        }
      });

      return totalBonus;
    } catch (error) {
      console.error(`[GameService] [calculateBaseCoinsPerClick] Error for user ${userId}:`, error);
      return 1; // возвращаем базовый бонус если ошибка
    }
  }

  // Рассчитать текущий множитель от бустов
  private calculateMultiplier(activeBoosts: IActiveBoost[]): number {
    if (activeBoosts.length === 0) return 1;

    // Если несколько бустов активны одновременно, используем только самый сильный
    // (время действия бустов складывается при активации, а не множители)
    return Math.max(...activeBoosts.map(b => b.multiplier));
  }

  // Активировать буст
  async activateBoost(
    userId: string,
    boostType: string,
    multiplier: number,
    durationSeconds: number,
  ): Promise<IActiveBoost> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Валидация множителя
    if (multiplier < 1 || multiplier > 3) {
      throw new BadRequestException(
        'Multiplier must be between 1 and 3 (x1 to x3)',
      );
    }

    const now = new Date();
    
    // Проверяем, есть ли уже активный буст того же типа и множителя
    const existingBoost = await this.userBoostRepository.findOne({
      where: { 
        user_id: userId,
        type: boostType as any,
        multiplier: multiplier,
      },
      order: { expires_at: 'DESC' },
    });

    let savedBoost;
    
    if (existingBoost && existingBoost.expires_at > now) {
      // Буст того же типа и силы уже активен - продлеваем его время
      const currentExpiresAt = existingBoost.expires_at.getTime();
      const newExpiresAt = new Date(currentExpiresAt + durationSeconds * 1000);
      
      existingBoost.expires_at = newExpiresAt;
      savedBoost = await this.userBoostRepository.save(existingBoost);
    } else {
      // Создаем новый буст
      const expiresAt = new Date(now.getTime() + durationSeconds * 1000);
      
      const boost = this.userBoostRepository.create({
        user_id: userId,
        type: boostType as any,
        multiplier: multiplier,
        activated_at: now,
        expires_at: expiresAt,
      });

      savedBoost = await this.userBoostRepository.save(boost);
    }

    // Очищаем кэш бустов для этого пользователя
    this.boostsCache.delete(userId);

    const remainingSeconds = Math.ceil((savedBoost.expires_at.getTime() - now.getTime()) / 1000);

    return {
      type: savedBoost.type,
      multiplier: Number(savedBoost.multiplier),
      endsAt: savedBoost.expires_at,
      remainingSeconds: remainingSeconds,
    };
  }

  // Проверка повышения уровня

  /**
   * Deduct coins from user with balance check
   * @throws BadRequestException if user has insufficient coins
   */
  async deductCoins(userId: string, amount: number): Promise<{ remaining: number }> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    // Atomic update with WHERE condition to prevent race conditions
    const result = await this.dataSource
      .createQueryBuilder()
      .update(User)
      .set({ coins: () => `coins - ${amount}` })
      .where('id = :id AND coins >= :amount', { id: userId, amount })
      .returning('coins')
      .execute();

    if (!result.affected || result.affected === 0) {
      // Either user not found or insufficient coins
      const user = await this.userRepository.findOne({
        where: { id: userId },
        select: ['coins'],
      });
      
      if (!user) {
        throw new NotFoundException('User not found');
      }
      
      throw new BadRequestException(
        `Insufficient coins. Required: ${amount}, Have: ${Number(user.coins)}`,
      );
    }

    return { remaining: Number(result.raw[0].coins) };
  }

  /**
   * Add coins to user
   */
  async addCoins(userId: string, amount: number): Promise<{ total: number }> {
    if (amount <= 0) {
      throw new BadRequestException('Amount must be greater than 0');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const currentCoins = Number(user.coins);
    const newCoins = currentCoins + amount;

    await this.userRepository.update(
      { id: userId },
      { coins: newCoins },
    );

    return { total: newCoins };
  }

  /**
   * Get user's current coins
   */
  async getUserCoins(userId: string): Promise<number> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'coins'],
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return Number(user.coins);
  }

  // Проверка и повышение уровня при достижении опыта
  private async checkLevelUp(userId: string, totalExperience: number): Promise<void> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      return;
    }

    const newLevel = this.calculateLevel(totalExperience);

    // Если уровень изменился, обновляем в БД
    if (newLevel !== user.level) {
      await this.userRepository.update(
        { id: userId },
        { level: newLevel },
      );
    }
  }

  // Вычислить уровень на основе опыта БЕЗ запроса к БД
  private calculateLevel(totalExperience: number): number {
    let newLevel = 1;
    let expUsed = 0;
    const expPerLevel = (level: number) => Math.floor(100 * Math.pow(1.5, level - 1));

    // Считаем сколько уровней можно пройти с текущим опытом
    while (true) {
      const expRequired = expPerLevel(newLevel);
      if (expUsed + expRequired > totalExperience) {
        break;
      }
      expUsed += expRequired;
      newLevel++;
    }

    return newLevel;
  }

  // ===== AUTO-CLICKER METHODS (ETAPE 2 - Redis Tracking) =====
  
  // Обновить время последней активности пользователя в Redis
  // Вызывается при каждом клике
  async updateLastActiveTime(userId: string): Promise<void> {
    const key = `user:${userId}:last_active_at`;
    const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp в секундах
    await this.redisService.set(key, timestamp.toString());
  }

  // Получить время последней активности из Redis
  async getLastActiveTime(userId: string): Promise<number | null> {
    const key = `user:${userId}:last_active_at`;
    const timestamp = await this.redisService.get(key);
    return timestamp ? parseInt(timestamp, 10) : null;
  }

  // Рассчитать время, прошедшее оффлайн (в секундах)
  // Если пользователь был онлайн меньше 5 часов назад - возвращаем разницу
  // Если больше 5 часов - возвращаем максимум (18000 сек)
  async calculateOfflineSeconds(userId: string): Promise<number> {
    const lastActiveTime = await this.getLastActiveTime(userId);
    
    // Если нет информации об активности, предполагаем пользователь свежий
    if (!lastActiveTime) {
      return 0;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    const offlineSeconds = currentTime - lastActiveTime;

    // Максимум 5 часов оффлайна
    return Math.min(offlineSeconds, this.AUTO_CLICKER_MAX_OFFLINE_SECONDS);
  }

  // Получить уровень auto-clicker'а для пользователя
  // Уровень хранится в user_services таблице с service_id = 'auto-clicker'
  async getAutoClickerLevel(userId: string): Promise<number> {
    try {
      const userService = await this.dataSource
        .createQueryBuilder()
        .from('user_services', 'us')
        .select('us.level', 'level')
        .innerJoin('services', 's', 's.id = us.service_id')
        .where('us.user_id = :userId', { userId })
        .andWhere('s.name = :name', { name: 'Auto-clicker' })
        .getRawOne();

      // getRawOne возвращает объект с ключом 'level' (из AS alias)
      const level = userService?.level;
      const result = level ? Number(level) : 0;
      return result;
    } catch (error) {
      console.error(`[AutoClicker] Error getting level for user ${userId}:`, error);
      return 0;
    }
  }

  // Рассчитать заработок offline для auto-clicker'а
  // coinsPerHour = earnings за 1 час
  // offlineSeconds = время оффлайна
  // assistantMultiplier = 1.5 если есть Assistant upgrade, иначе 1
  async calculateOfflineEarnings(
    userId: string,
    coinsPerHour: number,
  ): Promise<number> {
    // Получаем время оффлайна
    const offlineSeconds = await this.calculateOfflineSeconds(userId);
    
    if (offlineSeconds === 0) {
      return 0;
    }

    // Проверяем есть ли Assistant upgrade (service_id = 'assistant')
    const hasAssistant = await this.hasAssistantUpgrade(userId);
    const assistantMultiplier = hasAssistant ? 1.5 : 1;

    // earnings = coinsPerHour / 3600 * offlineSeconds * assistantMultiplier
    const baseEarnings = (coinsPerHour / 3600) * offlineSeconds;
    const finalEarnings = Math.floor(baseEarnings * assistantMultiplier);

    return finalEarnings;
  }

  // Проверить есть ли Assistant upgrade у пользователя
  private async hasAssistantUpgrade(userId: string): Promise<boolean> {
    try {
      const userService = await this.dataSource
        .createQueryBuilder()
        .from('user_services', 'us')
        .innerJoin('services', 's', 's.id = us.service_id')
        .where('us.user_id = :userId', { userId })
        .andWhere('s.name = :name', { name: 'Assistant' })
        .getExists();

      return userService;
    } catch (error) {
      console.error(`[AutoClicker] Error checking assistant for user ${userId}:`, error);
      return false;
    }
  }

  // Применить офлайн заработок к монетам пользователя
  async applyOfflineEarnings(userId: string, offlineEarnings: number): Promise<number> {
    if (offlineEarnings <= 0) {
      return 0;
    }

    const result = await this.dataSource
      .createQueryBuilder()
      .update(User)
      .set({
        coins: () => `coins + ${offlineEarnings}`,
        updated_at: new Date(),
      })
      .where('id = :id', { id: userId })
      .returning('coins')
      .execute();

    return result.raw?.[0]?.coins || 0;
  }

  // Очистить информацию об активности при покупке auto-clicker'а
  async resetLastActiveTime(userId: string): Promise<void> {
    const key = `user:${userId}:last_active_at`;
    await this.redisService.set(key, Math.floor(Date.now() / 1000).toString());
  }
}