import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

@Entity('referrals')
export class Referral {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  referrer_id: number;

  @Column({ type: 'uuid', unique: true })
  referred_id: number;

  @Column({ default: false })
  reward_claimed: boolean;

  @Column({ type: 'bigint', default: 0 })
  coins_earned: number;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'referrer_id', referencedColumnName: 'id' })
  referrer: User;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'referred_id', referencedColumnName: 'id' })
  referred: User;
}
