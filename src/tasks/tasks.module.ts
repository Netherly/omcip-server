import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Task } from './entities/task.entity';
import { UserTask } from './entities/user-task.entity';
import { DailyBonus } from './entities/daily-bonus.entity';
import { UserDailyClaim } from './entities/user-daily-claim.entity';
import { User } from '../user/entities/user.entity';
import { GameModule } from '../game/game.module';
import { TaskEventsModule } from '../events/task-events.module';
import { ReferralModule } from '../referral/referral.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { LoginRewardsService } from './services/login-rewards.service';
import { LoginRewardsController } from './controllers/login-rewards.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Task, UserTask, DailyBonus, UserDailyClaim, User]),
    forwardRef(() => GameModule),
    TaskEventsModule,
    ReferralModule,
    ScheduleModule.forRoot(),
  ],
  providers: [TasksService, LoginRewardsService],
  controllers: [TasksController, LoginRewardsController],
  exports: [TasksService, LoginRewardsService, TypeOrmModule],
})
export class TasksModule {}
