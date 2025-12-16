import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Upgrade } from '../entities/upgrade.entity';
import { UserUpgrade } from '../entities/user-upgrade.entity';
import { User } from '../../user/entities/user.entity';
import { UpgradesService } from './upgrades.service';
import { UpgradesController } from './upgrades.controller';
import { GameModule } from '../game.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Upgrade, UserUpgrade, User]),
    forwardRef(() => GameModule),
  ],
  controllers: [UpgradesController],
  providers: [UpgradesService],
  exports: [UpgradesService, TypeOrmModule],
})
export class UpgradesModule {}
