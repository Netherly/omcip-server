import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserTask } from './user-task.entity';

export enum TaskPeriod {
  DAILY = 'daily',
  WEEKLY = 'weekly',
}

export enum TaskActionType {
  TAPS = 'taps',
  EARN_COINS = 'earn_coins',
  INVITE_FRIEND = 'invite_friend',
  LOGIN_CLAIM = 'login_claim',
  LOGIN_STREAK = 'login_streak',
  COMPLETE_DAILY_TASKS = 'complete_daily_tasks',
}

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: TaskPeriod,
  })
  period: TaskPeriod;

  @Column({
    type: 'enum',
    enum: TaskActionType,
  })
  task_type: TaskActionType;

  @Column({ type: 'bigint', transformer: {
    from: (value: string | number) => value ? Number(value) : 0,
    to: (value: number) => value,
  }})
  requirement_value: number;

  @Column({ type: 'bigint', default: 0, transformer: {
    from: (value: string | number) => value ? Number(value) : 0,
    to: (value: number) => value,
  }})
  reward_coins: number;

  @Column({ type: 'int', nullable: true })
  reward_boost_duration: number;

  @Column({ type: 'int', nullable: true })
  reward_boost_multiplier: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ nullable: true })
  icon: string;

  @OneToMany(() => UserTask, (userTask) => userTask.task)
  user_tasks: UserTask[];
}
