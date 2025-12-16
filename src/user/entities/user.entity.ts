import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { UserUpgrade } from '../../game/entities/user-upgrade.entity';
import { UserService } from '../../services/entities/user-service.entity';
import { UserTask } from '../../tasks/entities/user-task.entity';
import { UserDailyClaim } from '../../tasks/entities/user-daily-claim.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', unique: true })
  telegram_id: number;

  @Column({ nullable: true })
  username: string;

  @Column({ nullable: true })
  first_name: string;

  @Column({ nullable: true })
  photo_url: string;

  @Column({ type: 'bigint', default: 0, transformer: {
    from: (value: string | number) => value ? Number(value) : 0,
    to: (value: number) => value,
  }})
  coins: number;

  @Column({ type: 'int', default: 10000 })
  energy: number;

  @Column({ type: 'int', default: 10000 })
  max_energy: number;

  @Column({ type: 'int', default: 1 })
  energy_regen_rate: number;

  @Column({ type: 'int', default: 1 })
  click_power: number;

  @Column({ type: 'int', default: 0 })
  passive_income_rate: number;

  @Column({ type: 'int', default: 1 })
  level: number;

  @Column({ type: 'bigint', default: 0, transformer: {
    from: (value: string | number) => value ? Number(value) : 0,
    to: (value: number) => value,
  }})
  experience: number;

  @Column({ type: 'bigint', default: 0, transformer: {
    from: (value: string | number) => value ? Number(value) : 0,
    to: (value: number) => value,
  }})
  total_taps: number;

  @Column({ type: 'bigint', nullable: true, transformer: {
    from: (value: string | number | null) => value ? Number(value) : null,
    to: (value: number | null) => value,
  }})
  referred_by: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  last_energy_update: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_click_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_login_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_daily_claim: Date;

  @Column({ type: 'int', default: 0 })
  daily_streak: number;

  // Referral system for tasks
  @Column({ type: 'int', default: 0 })
  daily_invited_friends: number;

  @Column({ type: 'int', default: 0 })
  weekly_invited_friends: number;

  @Column({ type: 'timestamp', nullable: true })
  last_daily_reset: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_weekly_reset: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => UserUpgrade, (userUpgrade) => userUpgrade.user)
  upgrades: UserUpgrade[];

  @OneToMany(() => UserService, (userService) => userService.user)
  services: UserService[];

  @OneToMany(() => UserTask, (userTask) => userTask.user)
  tasks: UserTask[];

  @OneToMany(() => UserDailyClaim, (claim) => claim.user)
  daily_claims: UserDailyClaim[];
}
