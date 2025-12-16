import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';

export enum BoostType {
  COINS_MULTIPLIER = 'coins_multiplier',
  CLICK_MULTIPLIER = 'click_multiplier',
}

@Entity('user_boosts')
export class UserBoost {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({
    type: 'enum',
    enum: BoostType,
  })
  type: BoostType;

  @Column({ 
    type: 'decimal', 
    precision: 10, 
    scale: 2,
    transformer: {
      from: (value) => value ? Number(value) : 1,
      to: (value) => value,
    }
  })
  multiplier: number; // 2.0 для x2, 3.0 для x3

  @CreateDateColumn()
  activated_at: Date;

  @Column({ type: 'timestamp' })
  expires_at: Date;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;
}
