import {
  IsString,
  IsNumber,
  IsEnum,
  IsOptional,
  Min,
  IsBoolean,
} from 'class-validator';
import { TaskPeriod, TaskActionType } from '../entities/task.entity';

export class CreateTaskDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsEnum(TaskPeriod)
  period: TaskPeriod;

  @IsEnum(TaskActionType)
  task_type: TaskActionType;

  @IsNumber()
  @Min(1)
  requirement_value: number;

  @IsNumber()
  @Min(0)
  reward_coins: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(1)
  reward_boost_duration?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  reward_boost_multiplier?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean = true;

  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  requirement_value?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  reward_coins?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  reward_boost_duration?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  reward_boost_multiplier?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  icon?: string;
}
