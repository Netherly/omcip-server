import { IsString, IsNumber, Min, Max } from 'class-validator';

export class ActivateBoostDto {
  @IsString()
  type: string; // 'coins_multiplier' или 'click_multiplier'

  @IsNumber()
  @Min(1)
  @Max(3)
  multiplier: number; // 1.0, 2.0 или 3.0

  @IsNumber()
  @Min(1)
  durationSeconds: number; // Длительность буста в секундах
}