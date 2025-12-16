import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum RewardType {
  COINS = 'coins',
  BOOST = 'boost',
  TASK_SKIP = 'task_skip',
  WEEKLY_TASK_SKIP = 'weekly_task_skip',
  RANDOM = 'random',
}

@Entity('daily_bonuses')
export class DailyBonus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'int', unique: true })
  day_number: number;

  @Column({
    type: 'enum',
    enum: RewardType,
  })
  reward_type: RewardType;

  @Column({ type: 'bigint', nullable: true })
  reward_coins: number | null;

  @Column({ type: 'int', nullable: true })
  boost_multiplier: number | null;

  @Column({ type: 'int', nullable: true })
  boost_duration: number | null;

  @Column({ type: 'jsonb', nullable: true })
  random_options: any;
}
