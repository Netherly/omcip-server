import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Upgrade } from '../entities/upgrade.entity';
import { UserUpgrade } from '../entities/user-upgrade.entity';
import { User } from '../../user/entities/user.entity';

@Injectable()
export class UpgradesService {
  constructor(
    @InjectRepository(Upgrade)
    private upgradeRepository: Repository<Upgrade>,
    @InjectRepository(UserUpgrade)
    private userUpgradeRepository: Repository<UserUpgrade>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  /**
   * Get all available upgrades
   */
  async getAllUpgrades(): Promise<Upgrade[]> {
    return this.upgradeRepository.find({
      where: { is_active: true },
      order: { base_cost: 'ASC' },
    });
  }

  /**
   * Get upgrade by ID
   */
  async getUpgradeById(upgradeId: string): Promise<Upgrade | null> {
    return this.upgradeRepository.findOne({
      where: { id: upgradeId },
    });
  }

  /**
   * Get user's owned upgrades
   */
  async getUserUpgrades(userId: string): Promise<UserUpgrade[]> {
    return this.userUpgradeRepository.find({
      where: { user_id: userId },
      relations: ['upgrade'],
      order: { purchased_at: 'DESC' },
    });
  }

  /**
   * Check if user has an upgrade
   */
  async hasUpgrade(userId: string, upgradeId: string): Promise<boolean> {
    const userUpgrade = await this.userUpgradeRepository.findOne({
      where: { user_id: userId, upgrade_id: upgradeId },
    });
    return !!userUpgrade;
  }

  /**
   * Get user upgrade record
   */
  async getUserUpgradeRecord(userId: string, upgradeId: string): Promise<UserUpgrade | null> {
    return this.userUpgradeRepository.findOne({
      where: { user_id: userId, upgrade_id: upgradeId },
      relations: ['upgrade'],
    });
  }

  /**
   * Calculate total damage boost from user's upgrades
   */
  async calculateUserDamageBoost(userId: string): Promise<number> {
    const userUpgrades = await this.userUpgradeRepository.find({
      where: { user_id: userId },
      relations: ['upgrade'],
    });

    return userUpgrades.reduce((total, userUpgrade) => {
      return total + (userUpgrade.upgrade?.base_value || 0);
    }, 0);
  }

  /**
   * Calculate base coins per click (сумма всех апгрейдов кликов)
   * Начальное значение = 1, плюс все купленные апгрейды
   */
  async calculateBaseCoinsPerClick(userId: string): Promise<number> {
    const userUpgrades = await this.userUpgradeRepository.find({
      where: { user_id: userId },
      relations: ['upgrade'],
    });

    // Базовое значение = 1, плюс все купленные апгрейды
    return 1 + userUpgrades.reduce((total, userUpgrade) => {
      return total + (userUpgrade.upgrade?.base_value || 0);
    }, 0);
  }

  /**
   * Get next upgrade recommendation (cheapest available not owned by user)
   */
  async getNextUpgradeRecommendation(userId: string): Promise<Upgrade | null> {
    const allUpgrades = await this.getAllUpgrades();

    for (const upgrade of allUpgrades) {
      const hasIt = await this.hasUpgrade(userId, upgrade.id);
      if (!hasIt) {
        return upgrade;
      }
    }

    return null;
  }

  /**
   * Create a user upgrade record (purchase)
   */
  async createUserUpgrade(userId: string, upgradeId: string): Promise<UserUpgrade> {
    const userUpgrade = this.userUpgradeRepository.create({
      user_id: userId,
      upgrade_id: upgradeId,
      purchased_at: new Date(),
    });

    return this.userUpgradeRepository.save(userUpgrade);
  }

  /**
   * Validate unlock conditions for an upgrade
   */
  async validateUnlockConditions(userId: string, upgrade: Upgrade): Promise<void> {
    const { unlock_conditions, level_requirement, character_requirement } = upgrade;

    // Check level requirement
    if (level_requirement) {
      const userLevel = await this.getUserLevel(userId); // Assume this method exists
      if (userLevel < level_requirement) {
        throw new Error(`User level ${userLevel} is insufficient. Requires level ${level_requirement}.`);
      }
    }

    // Check character requirement
    if (character_requirement) {
      const hasCharacter = await this.hasCharacter(userId, character_requirement); // Assume this method exists
      if (!hasCharacter) {
        throw new Error(`Character ${character_requirement} is required.`);
      }
    }

    // Check custom unlock conditions
    if (unlock_conditions) {
      // Example: Validate JSON-based conditions
      for (const [key, value] of Object.entries(unlock_conditions)) {
        if (!await this.checkCondition(userId, key, value)) { // Assume this method exists
          throw new Error(`Condition ${key}=${value} not met.`);
        }
      }
    }
  }

  /**
   * Get user level from database
   */
  async getUserLevel(userId: string): Promise<number> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['level'],
    });
    return user?.level || 1;
  }

  /**
   * Check if user has a specific character
   * Character unlocks are stored in user_upgrades or game state
   */
  async hasCharacter(userId: string, characterId: string): Promise<boolean> {
    // For now, return true - implement character system later
    // TODO: Implement character unlock tracking in database
    return true;
  }

  /**
   * Check custom unlock condition
   * Supports: total_taps, coins, upgrades_count, etc.
   */
  async checkCondition(userId: string, key: string, value: any): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
    });
    
    if (!user) return false;

    switch (key) {
      case 'total_taps':
        return user.total_taps >= Number(value);
      case 'coins':
        return user.coins >= Number(value);
      case 'level':
        return user.level >= Number(value);
      case 'upgrades_count':
        const upgradesCount = await this.userUpgradeRepository.count({
          where: { user_id: userId },
        });
        return upgradesCount >= Number(value);
      default:
        // Unknown condition, default to true
        return true;
    }
  }

  /**
   * Get all available upgrades with unlock conditions
   */
  async getAllUpgradesWithConditions(): Promise<Upgrade[]> {
    return this.upgradeRepository.find({
      where: { is_active: true },
      order: { base_cost: 'ASC' },
      select: [
        'id',
        'name',
        'description',
        'type',
        'base_cost',
        'base_value',
        'icon',
        'is_active',
        'unlock_conditions',
        'level_requirement',
        'character_requirement',
      ],
    });
  }
}
