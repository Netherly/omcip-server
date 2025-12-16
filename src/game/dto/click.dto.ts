import { IsNumber, IsArray, Min, Max, ArrayMaxSize, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ClickDto {
  @IsNumber()
  @Min(1)
  @Max(10) // Максимум 10 кликов за раз (GAME_CONFIG.CLICK_RATE_LIMIT.MAX_CLICKS_PER_SECOND)
  clicks: number;

  @IsArray()
  @ArrayMaxSize(100)
  @Type(() => Number)
  timestamps: number[]; // Unix timestamps в миллисекундах

  @IsOptional()
  @IsNumber()
  @Min(1)
  coinsPerClick?: number; // Количество монет за один клик (включая бонусы от апгрейдов)
}