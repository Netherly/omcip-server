import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Service } from './service.entity';

@Entity('user_services')
export class UserService {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  service_id: string;

  @CreateDateColumn()
  purchased_at: Date;

  @Column({ default: false })
  is_used: boolean;

  @Column({ type: 'timestamp', nullable: true })
  used_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  last_used_at: Date;

  @Column({ type: 'int', default: 0 })
  level: number;

  @Column({ default: false })
  confirmed_by_admin: boolean;

  @Column({ type: 'timestamp', nullable: true })
  confirmed_at: Date;

  @Column({ type: 'uuid', nullable: true })
  confirmed_by_user_id: string;

  @ManyToOne(() => User, (user) => user.services)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;

  @ManyToOne(() => Service, (service) => service.user_services)
  @JoinColumn({ name: 'service_id' })
  service: Service;
}
