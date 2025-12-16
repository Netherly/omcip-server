import { IsOptional, IsBoolean } from 'class-validator';

export class GetGameStateDto {
  @IsOptional()
  @IsBoolean()
  includeBoosts?: boolean = true;
}