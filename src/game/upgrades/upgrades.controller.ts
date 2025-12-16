import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
  BadRequestException,
  Inject,
  forwardRef,
  Logger,
} from '@nestjs/common';
import { UpgradesService } from './upgrades.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GameService } from '../game.service';
import { Upgrade } from '../entities/upgrade.entity';
import { UserUpgrade } from '../entities/user-upgrade.entity';

@Controller('upgrades')
export class UpgradesController {
  private readonly logger = new Logger(UpgradesController.name);

  constructor(
    private readonly upgradesService: UpgradesService,
    @Inject(forwardRef(() => GameService))
    private readonly gameService: GameService,
  ) {}

  /**
   * Get all available upgrades
   */
  @Get()
  async getAllUpgrades(): Promise<{
    upgrades: Upgrade[];
    total: number;
  }> {
    const upgrades = await this.upgradesService.getAllUpgrades();
    return {
      upgrades,
      total: upgrades.length,
    };
  }

  /**
   * Get all available upgrades with unlock conditions
   */
  @Get('with-conditions')
  async getAllUpgradesWithConditions(): Promise<{
    upgrades: Upgrade[];
    total: number;
  }> {
    const upgrades = await this.upgradesService.getAllUpgradesWithConditions();
    return {
      upgrades,
      total: upgrades.length,
    };
  }

  /**
   * Get specific upgrade by ID
   */
  @Get(':id')
  async getUpgradeById(@Param('id') upgradeId: string): Promise<Upgrade> {
    const upgrade = await this.upgradesService.getUpgradeById(upgradeId);
    if (!upgrade) {
      throw new HttpException('Upgrade not found', HttpStatus.NOT_FOUND);
    }
    return upgrade;
  }

  /**
   * Get user's owned upgrades
   */
  @UseGuards(JwtAuthGuard)
  @Get('user/my-upgrades')
  async getUserUpgrades(@Request() req): Promise<{
    upgrades: UserUpgrade[];
    total: number;
    damageBoost: number;
  }> {
    const userId = req.user.id;
    const upgrades = await this.upgradesService.getUserUpgrades(userId);
    const damageBoost = await this.upgradesService.calculateUserDamageBoost(userId);

    return {
      upgrades,
      total: upgrades.length,
      damageBoost,
    };
  }

  /**
   * Get next recommended upgrade for user
   */
  @UseGuards(JwtAuthGuard)
  @Get('user/next-recommendation')
  async getNextRecommendation(@Request() req): Promise<Upgrade | { message: string }> {
    const userId = req.user.id;
    const nextUpgrade = await this.upgradesService.getNextUpgradeRecommendation(userId);

    if (!nextUpgrade) {
      return { message: 'All upgrades purchased!' };
    }

    return nextUpgrade;
  }

  /**
   * Purchase an upgrade
   * Deducts coins and creates user_upgrade record
   * NOTE: Each upgrade can only be purchased ONCE per user
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/purchase')
  async purchaseUpgrade(@Param('id') upgradeId: string, @Request() req) {
    const userId = req.user.id;

    // Check if upgrade exists
    const upgrade = await this.upgradesService.getUpgradeById(upgradeId);
    if (!upgrade) {
      throw new HttpException('Upgrade not found', HttpStatus.NOT_FOUND);
    }

    // Check if user already owns this upgrade
    // Upgrades can only be purchased once per user
    const alreadyOwned = await this.upgradesService.hasUpgrade(userId, upgradeId);
    if (alreadyOwned) {
      throw new BadRequestException(
        `This upgrade has already been purchased. Each upgrade can only be bought once.`,
      );
    }

    // Validate unlock conditions
    try {
      await this.upgradesService.validateUnlockConditions(userId, upgrade);
    } catch (error) {
      throw new BadRequestException(error.message);
    }

    // Deduct coins from user
    try {
      await this.gameService.deductCoins(userId, Number(upgrade.base_cost));
    } catch (error) {
      throw new BadRequestException(error.message);
    }

    // Create user_upgrade record
    const savedUpgrade = await this.upgradesService.createUserUpgrade(
      userId,
      upgradeId,
    );

    // Analytics: Log purchase event
    this.logger.log({
      event: 'upgrade.purchased',
      userId,
      upgradeId,
      upgradeName: upgrade.name,
      upgradeType: upgrade.type,
      cost: upgrade.base_cost,
      timestamp: new Date().toISOString(),
    });

    return {
      success: true,
      message: 'Upgrade purchased successfully',
      data: {
        upgrade: upgrade,
        purchased: true,
        purchasedAt: savedUpgrade.purchased_at,
        newDamageBoost: await this.upgradesService.calculateUserDamageBoost(userId),
      },
    };
  }
}
