export interface IGameState {
  user: {
    id: string;
    telegram_id: number;
    username: string;
    first_name?: string;
    coins: number;
    energy: number;
    max_energy: number;
    energy_regen_rate: number;
    click_power: number;
    level: number;
    experience: number;
    total_taps: number;
    base_coins_per_click: number;
    upgrades?: any[];
    services?: any[];
    tasks?: any[];
    daily_claims?: any[];
  };
  user_services: any[]; // Покупленные услуги пользователя
  activeBoosts: IActiveBoost[];
  serverTime: Date;
}

export interface IActiveBoost {
  type: string;
  multiplier: number;
  endsAt: Date;
  remainingSeconds: number;
}

export interface IClickResult {
  success: boolean;
  coins: number;
  energy: number;
  total_taps: number;
  earned: number;
  currentMultiplier: number;
}

export interface IAutoClickerStatus {
  level: number; // 0-5
  total_earnings: number; // Всего заработано автокликером
  offline_earnings: number; // Заработано в последний офлайн период
  is_active: boolean; // Есть ли уровень
  last_active_at: Date | null; // Последний раз был активен
  offline_time_seconds: number; // Сколько времени был офлайн
  has_assistant_bonus: boolean; // Куплен ли assistant upgrade
}

export interface IAutoClickerConfig {
  level: number;
  coinsPerHour: number;
  cost: number;
  name: string;
}