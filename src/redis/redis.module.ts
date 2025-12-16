import { Module, Global } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global() // Делаем модуль глобальным, чтобы не импортировать везде
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
