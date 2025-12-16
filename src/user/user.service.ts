import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

interface CreateUserDto {
  telegram_id: number;
  username?: string;
  first_name: string;
  photo_url?: string;
}

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async findOne(id: string): Promise<User> {
    const user = await this.userRepository.findOne({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async findByTelegramId(telegramId: number): Promise<User | null> {
    return this.userRepository.findOne({
      where: { telegram_id: telegramId },
    });
  }

  async create(createUserDto: CreateUserDto): Promise<User> {
    // Используем create для создания экземпляра
    const user = this.userRepository.create({
      telegram_id: createUserDto.telegram_id,
      username: createUserDto.username ?? undefined,
      first_name: createUserDto.first_name,
      photo_url: createUserDto.photo_url ?? undefined,
      coins: 0,
      energy: 10000,
      max_energy: 10000,
      energy_regen_rate: 1,
      click_power: 1,
      level: 1,
      experience: 0,
      total_taps: 0,
      last_click_at: new Date(),
    });

    return this.userRepository.save(user);
  }

  async update(id: string, updateData: Partial<User>): Promise<User> {
    await this.userRepository.update(id, {
      ...updateData,
      updated_at: new Date(),
    });

    return this.findOne(id);
  }
}