import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Service } from './entities/service.entity';
import { UserService } from './entities/user-service.entity';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { GameModule } from '../game/game.module';
import { ServiceEventsModule } from '../events/service-events.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Service, UserService]),
    forwardRef(() => GameModule),
    ServiceEventsModule,
    UserModule,
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService, TypeOrmModule],
})
export class ServicesModule {}
