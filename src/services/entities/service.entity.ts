import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserService } from './user-service.entity';

@Entity('services')
export class Service {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'int' })
  discount_percent: number;

  @Column({ type: 'bigint' })
  original_price: number;

  @Column({ type: 'bigint' })
  cost_coins: number;

  @Column({ default: true })
  is_active: boolean;

  @Column({ nullable: true })
  icon: string;

  @Column({ type: 'int', default: 0 })
  cooldown_days: number;

  @OneToMany(() => UserService, (userService) => userService.service)
  user_services: UserService[];
}
