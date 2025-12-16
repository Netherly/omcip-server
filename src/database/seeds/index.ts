import { DataSource } from 'typeorm';
import { Upgrade } from '../../game/entities/upgrade.entity';
import { Task } from '../../tasks/entities/task.entity';
import { Service } from '../../services/entities/service.entity';
import { User } from '../../user/entities/user.entity';
import { DailyBonus } from '../../tasks/entities/daily-bonus.entity';
import { upgradesSeed } from './upgrades.seed';
import { tasksSeed, dailyBonusesSeed } from './tasks.seed';
import { servicesSeed } from './services.seed';

export async function runSeeds(dataSource: DataSource): Promise<void> {
  console.log('🌱 Starting database seeding...');

  try {
    // Seeding Test User
    console.log('👤 Seeding test user...');
    const userRepository = dataSource.getRepository(User);
    const testUserExists = await userRepository.findOne({ where: { telegram_id: 999999999 } });

    if (!testUserExists) {
      const testUser = userRepository.create({
        telegram_id: 999999999,
        username: 'test_user',
        first_name: 'Test',
        coins: 100000,
        energy: 10000,
        max_energy: 10000,
        click_power: 1,
        level: 1,
      });
      await userRepository.save(testUser);
      console.log('✅ Test user created');
    } else {
      console.log('⏭️  Test user already exists. Skipping...');
    }

    // Seeding Upgrades
    console.log('📦 Seeding upgrades...');
    const upgradeRepository = dataSource.getRepository(Upgrade);
    const existingUpgrades = await upgradeRepository.count();

    if (existingUpgrades === 0) {
      await upgradeRepository.insert(upgradesSeed);
      console.log(`✅ Inserted ${upgradesSeed.length} upgrades`);
    } else {
      console.log(`⏭️  Upgrades already exist (${existingUpgrades}). Skipping...`);
    }

    // Seeding Tasks
    console.log('📋 Seeding tasks...');
    const taskRepository = dataSource.getRepository(Task);
    const existingTasks = await taskRepository.count();

    if (existingTasks === 0) {
      await taskRepository.insert(tasksSeed);
      console.log(`✅ Inserted ${tasksSeed.length} tasks`);
    } else {
      console.log(`⏭️  Tasks already exist (${existingTasks}). Skipping...`);
    }

    // Seeding Services
    console.log('🏥 Seeding services...');
    const serviceRepository = dataSource.getRepository(Service);
    const existingServices = await serviceRepository.count();

    if (existingServices === 0) {
      await serviceRepository.insert(servicesSeed);
      console.log(`✅ Inserted ${servicesSeed.length} services`);
    } else {
      console.log(`⏭️  Services already exist (${existingServices}). Skipping...`);
    }

    // Seeding Daily Bonuses
    console.log('🎁 Seeding daily bonuses...');
    const dailyBonusRepository = dataSource.getRepository(DailyBonus);
    const existingBonuses = await dailyBonusRepository.count();

    if (existingBonuses === 0) {
      await dailyBonusRepository.insert(dailyBonusesSeed);
      console.log(`✅ Inserted ${dailyBonusesSeed.length} daily bonuses`);
    } else {
      console.log(`⏭️  Daily bonuses already exist (${existingBonuses}). Skipping...`);
    }

    console.log('✨ Database seeding completed successfully!');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  }
}
