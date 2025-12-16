import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

@Entity('user_daily_claims')
@Index('idx_user_daily_claims_user_claimed', ['user_id', 'claimed_at'])
// Note: Unique constraint (user_id, CAST(claimed_at AS DATE), day_number) 
// created manually via migration - TypeORM doesn't support SQL functions in WHERE
export class UserDailyClaim {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'int' })
  day_number: number;

  @CreateDateColumn()
  claimed_at: Date;

  @Column({ type: 'text' })
  reward_received: string;

  @ManyToOne(() => User, (user) => user.daily_claims, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;
}

