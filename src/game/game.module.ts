import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { GameService } from './game.service';
import { GameGateway } from './game.gateway';
import { GameController } from './game.controller';
import { CharactersController } from './characters/characters.controller';
import { User } from '../user/entities/user.entity';
import { UserBoost } from './entities/user-boost.entity';
import { UserUpgrade } from './entities/user-upgrade.entity';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UpgradesModule } from './upgrades/upgrades.module';
import { UserModule } from '../user/user.module';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserBoost, UserUpgrade]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: configService.get('JWT_EXPIRES_IN') },
      }),
    }),
    forwardRef(() => UpgradesModule),
    UserModule,
    forwardRef(() => TasksModule),
  ],
  controllers: [GameController, CharactersController],
  providers: [GameService, GameGateway],
  exports: [GameService, GameGateway, TypeOrmModule],
})
export class GameModule {}