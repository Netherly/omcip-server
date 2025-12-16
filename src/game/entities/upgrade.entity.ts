import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { UserUpgrade } from './user-upgrade.entity';

export enum UpgradeType {
  CLICK_POWER = 'click_power',
  ENERGY = 'energy',
  ENERGY_REGEN = 'energy_regen',
  PASSIVE_INCOME = 'passive_income',
}

@Entity('upgrades')
export class Upgrade {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ type: 'text' })
  description: string;

  @Column({
    type: 'enum',
    enum: UpgradeType,
  })
  type: UpgradeType;

  @Column({ type: 'bigint' })
  base_cost: number;

  @Column({ type: 'int' })
  base_value: number;

  @Column({ nullable: true })
  icon: string;

  @Column({ default: true })
  is_active: boolean;

  @Column({ type: 'json', nullable: true })
  unlock_conditions: Record<string, any>;

  @Column({ type: 'int', nullable: true })
  level_requirement: number;

  @Column({ type: 'uuid', nullable: true })
  character_requirement: string;

  @OneToMany(() => UserUpgrade, (userUpgrade) => userUpgrade.upgrade)
  user_upgrades: UserUpgrade[];
}
