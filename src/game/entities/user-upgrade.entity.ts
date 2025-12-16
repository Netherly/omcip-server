import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Upgrade } from './upgrade.entity';

@Entity('user_upgrades')
export class UserUpgrade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  upgrade_id: string;

  @CreateDateColumn()
  purchased_at: Date;

  @UpdateDateColumn()
  last_upgraded_at: Date;

  @ManyToOne(() => User, (user) => user.upgrades)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;

  @ManyToOne(() => Upgrade, (upgrade) => upgrade.user_upgrades)
  @JoinColumn({ name: 'upgrade_id' })
  upgrade: Upgrade;
}
