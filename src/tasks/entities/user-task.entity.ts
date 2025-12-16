import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { User } from '../../user/entities/user.entity';
import { Task } from './task.entity';

@Entity('user_tasks')
export class UserTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid' })
  task_id: string;

  @Column({ type: 'bigint', default: 0, transformer: {
    from: (value: string | number) => value ? Number(value) : 0,
    to: (value: number) => value,
  }})
  progress: number;

  @Column({ default: false })
  completed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  completed_at: Date | null;

  @Column({ default: false })
  claimed: boolean;

  @Column({ type: 'timestamp', nullable: true })
  claimed_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  reset_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  started_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => User, (user) => user.tasks)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: User;

  @ManyToOne(() => Task, (task) => task.user_tasks)
  @JoinColumn({ name: 'task_id' })
  task: Task;
}
