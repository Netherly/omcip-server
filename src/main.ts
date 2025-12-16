import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import {
  HttpExceptionFilter,
  AllExceptionsFilter,
} from './common/filters/http-exception.filter';
import { DataSource } from 'typeorm';
import { runSeeds } from './database/seeds';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Удаляет поля, которых нет в DTO
      forbidNonWhitelisted: true, // Выдает ошибку при лишних полях
      transform: true, // Автоматически трансформирует типы
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(), new HttpExceptionFilter());

  app.enableCors({
    origin: '*', // В продакшене укажи конкретный домен!
    credentials: true,
  });

  app.setGlobalPrefix('api');

  // Run database seeds
  const dataSource = app.get(DataSource);
  if (dataSource && dataSource.isInitialized) {
    await runSeeds(dataSource);
  }

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`
    🚀 Server is running on: http://localhost:${port}
    📚 API prefix: /api
    🎮 Game endpoint: http://localhost:${port}/api/game
  `);
}
bootstrap();
