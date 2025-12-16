import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Service } from './entities/service.entity';
import { UserService } from './entities/user-service.entity';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private serviceRepository: Repository<Service>,
    @InjectRepository(UserService)
    private userServiceRepository: Repository<UserService>,
  ) {}

  /**
   * Get all available services
   */
  async getAllServices(): Promise<Service[]> {
    const services = await this.serviceRepository.find({
      where: { is_active: true },
    });
    
    // Exclude Auto-clicker service (internal use only)
    return services.filter(service => 
      service.name !== 'Auto-clicker' && 
      !service.name.toLowerCase().includes('auto-clicker')
    );
  }

  /**
   * Get service by ID
   */
  async getServiceById(serviceId: string): Promise<Service | null> {
    return this.serviceRepository.findOne({
      where: { id: serviceId },
    });
  }

  /**
   * Get service by name
   */
  async getServiceByName(name: string): Promise<Service | null> {
    return this.serviceRepository.findOne({
      where: { name },
    });
  }

  /**
   * Check if user can use a service (cooldown check)
   */
  async canUseService(userId: string, serviceId: string): Promise<{
    canUse: boolean;
    remainingCooldown?: number; // in seconds
    message?: string;
  }> {
    const service = await this.getServiceById(serviceId);
    if (!service) {
      return {
        canUse: false,
        message: 'Service not found',
      };
    }

    // Get user's service usage history
    const userService = await this.userServiceRepository.findOne({
      where: {
        user_id: userId as any,
        service_id: serviceId,
      },
    });

    // If user never purchased it, they can purchase it
    if (!userService || !userService.purchased_at) {
      return {
        canUse: true,
      };
    }

    // Check cooldown - используем purchased_at для отсчета cooldown
    const purchasedAt = new Date(userService.purchased_at);
    const cooldownMs = service.cooldown_days * 24 * 60 * 60 * 1000;
    const nextAvailableTime = new Date(purchasedAt.getTime() + cooldownMs);
    const now = new Date();

    if (now >= nextAvailableTime) {
      return {
        canUse: true,
      };
    }

    const remainingMs = nextAvailableTime.getTime() - now.getTime();
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    return {
      canUse: false,
      remainingCooldown: remainingSeconds,
      message: `This service is on cooldown. Available in ${service.cooldown_days} days`,
    };
  }

  /**
   * Mark service as used by updating last_used_at
   */
  async markServiceAsUsed(userId: string, serviceId: string): Promise<UserService> {
    let userService = await this.userServiceRepository.findOne({
      where: {
        user_id: userId as any,
        service_id: serviceId,
      },
    });

    const now = new Date();

    if (!userService) {
      // Create new record if doesn't exist
      userService = this.userServiceRepository.create({
        user_id: userId as any,
        service_id: serviceId,
        is_used: true,
        purchased_at: now,  // КРИТИЧНО: устанавливаем purchased_at при первой покупке
        last_used_at: now,
      });
    } else {
      // Update existing record
      userService.is_used = true;
      userService.last_used_at = now;
      // Не перезаписываем purchased_at если уже был куплен
      if (!userService.purchased_at) {
        userService.purchased_at = now;
      }
    }

    return this.userServiceRepository.save(userService);
  }

  /**
   * Get user's service usage record
   */
  async getUserServiceRecord(userId: string, serviceId: string): Promise<UserService | null> {
    return this.userServiceRepository.findOne({
      where: {
        user_id: userId as any,
        service_id: serviceId,
      },
      relations: ['service'],
    });
  }

  /**
   * Update auto-clicker level for user
   * Creates or updates user_services record with new level
   */
  async updateAutoClickerLevel(userId: string, newLevel: number): Promise<UserService> {
    // Find auto-clicker service by name
    const autoClickerService = await this.serviceRepository.findOne({
      where: { name: 'Auto-clicker' },
    });

    if (!autoClickerService) {
      console.error('[Services] Auto-clicker service not found in database');
      throw new Error('Auto-clicker service not configured. Please contact support.');
    }

    // Find or create user service record
    let userService = await this.userServiceRepository.findOne({
      where: {
        user_id: userId as any,
        service_id: autoClickerService.id,
      },
    });

    if (!userService) {
      // Create new record
      userService = this.userServiceRepository.create({
        user_id: userId as any,
        service_id: autoClickerService.id,
        level: newLevel,
        purchased_at: new Date(),
      });
    } else {
      // Update existing record
      userService.level = newLevel;
    }

    return this.userServiceRepository.save(userService);
  }

  /**
   * Confirm service provision by admin (for dental clinic)
   * Marks that the service was actually provided to the user
   */
  async confirmServiceByAdmin(
    userServiceId: string, 
    adminUserId: string
  ): Promise<UserService> {
    const userService = await this.userServiceRepository.findOne({
      where: { id: userServiceId },
      relations: ['service', 'user'],
    });

    if (!userService) {
      throw new Error('Service purchase record not found');
    }

    if (userService.confirmed_by_admin) {
      throw new Error('Service already confirmed');
    }

    userService.confirmed_by_admin = true;
    userService.confirmed_at = new Date();
    userService.confirmed_by_user_id = adminUserId;

    return this.userServiceRepository.save(userService);
  }

  /**
   * Get unconfirmed services (for admin panel)
   */
  async getUnconfirmedServices(limit: number = 50): Promise<UserService[]> {
    return this.userServiceRepository.find({
      where: { confirmed_by_admin: false },
      relations: ['service', 'user'],
      order: { purchased_at: 'DESC' },
      take: limit,
    });
  }
}
