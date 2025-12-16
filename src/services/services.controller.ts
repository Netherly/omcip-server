import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { ServicesService } from './services.service';
import { GameService } from '../game/game.service';
import { ServiceEventsService } from '../events/service-events.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../user/entities/user.entity';

@Controller('services')
export class ServicesController {
  private readonly logger = new Logger(ServicesController.name);

  constructor(
    private readonly servicesService: ServicesService,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
    private readonly serviceEventsService: ServiceEventsService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Get all available services
   */
  @Get()
  async getAllServices() {
    const services = await this.servicesService.getAllServices();
    return {
      success: true,
      data: services,
    };
  }

  /**
   * Check if user can use a service (cooldown status)
   * ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
   */
  @UseGuards(JwtAuthGuard)
  @Get(':id/check-cooldown')
  async checkCooldown(@Param('id') serviceId: string, @Request() req) {
    const userId = req.user.id;

    const cooldownStatus = await this.servicesService.canUseService(
      userId,
      serviceId,
    );

    return {
      success: true,
      data: cooldownStatus,
    };
  }

  /**
   * Use (activate) a service
   * This marks the service as used and sets the cooldown
   * ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/use')
  async useService(@Param('id') serviceId: string, @Request() req) {
    const userId = req.user.id;

    // Check if service exists
    const service = await this.servicesService.getServiceById(serviceId);
    if (!service) {
      throw new BadRequestException('Service not found');
    }

    // Check if user can use the service (cooldown check)
    const canUse = await this.servicesService.canUseService(userId, serviceId);
    if (!canUse.canUse) {
      throw new BadRequestException(
        `Cannot use service: ${canUse.message}. Remaining cooldown: ${canUse.remainingCooldown} seconds`,
      );
    }

    // Mark service as used
    const userServiceRecord = await this.servicesService.markServiceAsUsed(
      userId,
      serviceId,
    );

    return {
      success: true,
      message: 'Service used successfully',
      data: {
        service: service,
        lastUsed: userServiceRecord.last_used_at,
        nextAvailable: new Date(
          new Date(userServiceRecord.last_used_at).getTime() +
            service.cooldown_days * 24 * 60 * 60 * 1000,
        ),
      },
    };
  }

  /**
   * Get auto-clicker status for current user
   * Returns: level, current earnings, offline earnings (if any), is_active, last_active_at
   * ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
   */
  @UseGuards(JwtAuthGuard)
  @Get('auto-clicker/status')
  async getAutoClickerStatus(@Request() req) {
    const userId = req.user.id;

    try {
      const level = await this.gameService.getAutoClickerLevel(userId);
      
      // Auto-clicker config with costs and earnings
      const autoClickerConfig = {
        1: { cost: 10000, coinsPerHour: 1000, name: 'Auto-clicker Lvl 1' },
        2: { cost: 96000, coinsPerHour: 1500, name: 'Auto-clicker Lvl 2' },
        3: { cost: 252000, coinsPerHour: 2500, name: 'Auto-clicker Lvl 3' },
        4: { cost: 660000, coinsPerHour: 4000, name: 'Auto-clicker Lvl 4' },
        5: { cost: 1536000, coinsPerHour: 6000, name: 'Auto-clicker Lvl 5' },
      };

      // Get offline earnings - сумма всех уровней
      const offlineSeconds = await this.gameService.calculateOfflineSeconds(userId);
      let totalCoinsPerHour = 0;
      
      // Суммируем доход от всех уровней с 1 по текущий
      for (let i = 1; i <= level; i++) {
        totalCoinsPerHour += autoClickerConfig[i].coinsPerHour;
      }
      
      const offlineEarnings = level > 0 
        ? await this.gameService.calculateOfflineEarnings(userId, totalCoinsPerHour)
        : 0;

      const response = {
        success: true,
        data: {
          level,
          is_active: level > 0,
          offline_seconds: offlineSeconds,
          offline_earnings: offlineEarnings,
          total_coins_per_hour: totalCoinsPerHour,
          current_config: level > 0 ? autoClickerConfig[level] : null,
          next_level_config: level < 5 ? autoClickerConfig[level + 1] : null,
        },
      };
      
      return response;
    } catch (error) {
      console.error('[AutoClicker] Error getting status:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Purchase next level of auto-clicker
   * Validates coins, updates user_services with new level, resets last_active_at
   * ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
   */
  @UseGuards(JwtAuthGuard)
  @Post('auto-clicker/purchase')
  async purchaseAutoClickerLevel(@Request() req) {
    const userId = req.user.id;

    try {
      // Auto-clicker config
      const autoClickerConfig = {
        1: { cost: 10000, coinsPerHour: 1000, name: 'Auto-clicker Lvl 1' },
        2: { cost: 96000, coinsPerHour: 1500, name: 'Auto-clicker Lvl 2' },
        3: { cost: 252000, coinsPerHour: 2500, name: 'Auto-clicker Lvl 3' },
        4: { cost: 660000, coinsPerHour: 4000, name: 'Auto-clicker Lvl 4' },
        5: { cost: 1536000, coinsPerHour: 6000, name: 'Auto-clicker Lvl 5' },
      };

      // STEP 1: Verify auto-clicker service exists in database
      const autoClickerService = await this.servicesService.getServiceByName('Auto-clicker');
      if (!autoClickerService) {
        console.error(`[AutoClicker] FATAL: Auto-clicker service not found in database`);
        throw new BadRequestException('Auto-clicker service not configured in system');
      }

      // STEP 2: Get current level
      const currentLevel = await this.gameService.getAutoClickerLevel(userId);
      
      const nextLevel = currentLevel + 1;

      // STEP 3: Validate max level
      if (nextLevel > 5) {
        throw new BadRequestException('Auto-clicker is already at maximum level (5)');
      }

      // STEP 4: Get cost for next level
      const cost = autoClickerConfig[nextLevel].cost;

      // STEP 5: Check if user has enough coins (before deducting)
      const userCoins = await this.gameService.getUserCoins(userId);
      if (userCoins < cost) {
        console.error(`[AutoClicker] ✗ Insufficient coins`);
        throw new BadRequestException(`Insufficient coins. You have ${userCoins}, need ${cost}`);
      }

      // STEP 6: Ensure user_services record exists BEFORE deducting coins
      const existingRecord = await this.servicesService.getUserServiceRecord(userId, autoClickerService.id);
      if (!existingRecord) {
        await this.servicesService.updateAutoClickerLevel(userId, currentLevel);
      }

      // STEP 7: Deduct coins
      try {
        await this.gameService.deductCoins(userId, cost);
      } catch (error) {
        console.error(`[AutoClicker] ✗ Failed to deduct coins:`, error.message);
        throw new BadRequestException(`Failed to deduct coins: ${error.message}`);
      }

      // STEP 8: Update auto-clicker level in user_services
      const updateResult = await this.servicesService.updateAutoClickerLevel(userId, nextLevel);

      // STEP 9: Reset last active time in Redis
      await this.gameService.resetLastActiveTime(userId);

      const responseData = {
        success: true,
        message: `Auto-clicker upgraded to level ${nextLevel}`,
        data: {
          new_level: nextLevel,
          cost_deducted: cost,
          coins_per_hour: autoClickerConfig[nextLevel].coinsPerHour,
          total_coins_per_hour: (() => {
            // Возвращаем суммированный доход от всех уровней
            let total = 0;
            for (let i = 1; i <= nextLevel; i++) {
              total += autoClickerConfig[i].coinsPerHour;
            }
            return total;
          })(),
        },
      };
      
      return responseData;
    } catch (error) {
      console.error('[AutoClicker] Error purchasing level:', error.message);
      throw error;
    }
  }

  /**
   * Get user's service usage record
   * ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
   */
  @UseGuards(JwtAuthGuard)
  @Get(':id/usage')
  async getServiceUsage(@Param('id') serviceId: string, @Request() req) {
    const userId = req.user.id;

    const record = await this.servicesService.getUserServiceRecord(
      userId,
      serviceId,
    );

    if (!record) {
      return {
        success: true,
        data: {
          used: false,
          lastUsed: null,
        },
      };
    }

    const service = await this.servicesService.getServiceById(serviceId);
    if (!service) {
      throw new BadRequestException('Service not found');
    }

    return {
      success: true,
      data: {
        used: record.is_used,
        lastUsed: record.last_used_at,
        nextAvailable: record.last_used_at
          ? new Date(
              new Date(record.last_used_at).getTime() +
                service.cooldown_days * 24 * 60 * 60 * 1000,
            )
          : null,
      },
    };
  }

  /**
   * Purchase a service
   * Deducts coins and creates user_service record
   * ДОЛЖНО БЫТЬ ПЕРЕД /:id чтобы не перехватиться
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/purchase')
  async purchaseService(@Param('id') serviceId: string, @Request() req) {
    const userId = req.user.id;

    // Check if service exists
    const service = await this.servicesService.getServiceById(serviceId);
    if (!service) {
      throw new BadRequestException('Service not found');
    }

    // Check cooldown status BEFORE deducting coins
    const cooldownStatus = await this.servicesService.canUseService(userId, serviceId);
    if (!cooldownStatus.canUse) {
      throw new BadRequestException(
        cooldownStatus.message || 'Service is on cooldown'
      );
    }

    // Deduct coins from user
    try {
      await this.gameService.deductCoins(userId, Number(service.cost_coins));
    } catch (error) {
      throw new BadRequestException(error.message);
    }

    // Create user_service record (purchase record)
    const userService = await this.servicesService.getUserServiceRecord(
      userId,
      serviceId,
    );

    // If already purchased, just return the existing record
    if (userService) {
      return {
        success: true,
        message: 'Service already owned',
        data: {
          service: service,
          purchased: true,
          purchasedAt: userService.purchased_at,
        },
      };
    }

    // Create new purchase record
    const newPurchase = await this.servicesService.markServiceAsUsed(
      userId,
      serviceId,
    );

    // Get user data for event
    const user = await this.userRepository.findOne({ where: { id: userId } });

    // Emit service purchased event
    if (user) {
      this.serviceEventsService.emitServicePurchased({
        userId,
        telegram_id: Number(user.telegram_id),
        serviceId,
        serviceName: service.name,
        cost: Number(service.cost_coins),
        purchasedAt: newPurchase.purchased_at,
        cooldownDays: service.cooldown_days,
        userName: user.username || user.first_name || 'Unknown',
        username: user.username,
        first_name: user.first_name,
      });
    }

    return {
      success: true,
      message: 'Service purchased successfully',
      data: {
        service: service,
        purchased: true,
        purchasedAt: newPurchase.purchased_at,
      },
    };
  }

  /**
   * Confirm service by admin (for dental clinic)
   * POST /services/confirm/:userServiceId
   */
  @UseGuards(JwtAuthGuard)
  @Post('confirm/:userServiceId')
  async confirmService(
    @Param('userServiceId') userServiceId: string,
    @Request() req,
  ) {
    const adminUserId = req.user.id;

    // TODO: Add admin role check here if needed
    // For now, any authenticated user can confirm
    // You can add: if (!req.user.isAdmin) throw new ForbiddenException('Admin access required');

    try {
      const confirmedService = await this.servicesService.confirmServiceByAdmin(
        userServiceId,
        adminUserId,
      );

      return {
        success: true,
        message: 'Service confirmed successfully',
        data: {
          id: confirmedService.id,
          confirmed_at: confirmedService.confirmed_at,
          confirmed_by_admin: confirmedService.confirmed_by_admin,
        },
      };
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Get unconfirmed services (for admin panel)
   * GET /services/unconfirmed
   */
  @UseGuards(JwtAuthGuard)
  @Get('admin/unconfirmed')
  async getUnconfirmedServices(@Request() req) {
    // TODO: Add admin role check here if needed

    const services = await this.servicesService.getUnconfirmedServices(50);

    return {
      success: true,
      count: services.length,
      data: services.map((us) => ({
        id: us.id,
        user: {
          id: us.user.id,
          telegram_id: us.user.telegram_id,
          username: us.user.username,
          first_name: us.user.first_name,
        },
        service: {
          id: us.service.id,
          name: us.service.name,
          description: us.service.description,
        },
        purchased_at: us.purchased_at,
        confirmed_by_admin: us.confirmed_by_admin,
      })),
    };
  }

  /**
   * Get specific service by ID
   * ДОЛЖНО БЫТЬ ПОСЛЕДНИМ чтобы не перехватываться дочерних маршрутов
   */
  @Get(':id')
  async getService(@Param('id') serviceId: string) {
    const service = await this.servicesService.getServiceById(serviceId);
    if (!service) {
      throw new BadRequestException('Service not found');
    }
    return {
      success: true,
      data: service,
    };
  }
}
