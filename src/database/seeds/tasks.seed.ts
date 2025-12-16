import { Task, TaskPeriod, TaskActionType } from '../../tasks/entities/task.entity';
import { DailyBonus, RewardType } from '../../tasks/entities/daily-bonus.entity';

export const tasksSeed: Omit<Task, 'id' | 'user_tasks'>[] = [];
// TODO: Добавить задания когда будет известен их список

export const dailyBonusesSeed: Omit<DailyBonus, 'id'>[] = [
  {
    day_number: 1,
    reward_type: RewardType.COINS,
    reward_coins: 1000,
    boost_multiplier: null,
    boost_duration: null,
    random_options: null,
  },
  {
    day_number: 2,
    reward_type: RewardType.BOOST,
    reward_coins: null,
    boost_multiplier: 2,
    boost_duration: 30,
    random_options: null,
  },
  {
    day_number: 3,
    reward_type: RewardType.RANDOM,
    reward_coins: null,
    boost_multiplier: null,
    boost_duration: null,
    random_options: { type: 'small_chest' },
  },
  {
    day_number: 4,
    reward_type: RewardType.COINS,
    reward_coins: 10000,
    boost_multiplier: null,
    boost_duration: null,
    random_options: null,
  },
  {
    day_number: 5,
    reward_type: RewardType.BOOST,
    reward_coins: null,
    boost_multiplier: 2,
    boost_duration: 60,
    random_options: null,
  },
  {
    day_number: 6,
    reward_type: RewardType.TASK_SKIP,
    reward_coins: null,
    boost_multiplier: null,
    boost_duration: null,
    random_options: { type: 'daily_task' },
  },
  {
    day_number: 7,
    reward_type: RewardType.RANDOM,
    reward_coins: null,
    boost_multiplier: null,
    boost_duration: null,
    random_options: { type: 'large_chest' },
  },
];

