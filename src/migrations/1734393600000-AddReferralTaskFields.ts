import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddReferralTaskFields1734393600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Добавляем поля для реферальной системы с заданиями
    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'daily_invited_friends',
        type: 'int',
        default: 0,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'weekly_invited_friends',
        type: 'int',
        default: 0,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'last_daily_reset',
        type: 'timestamp',
        isNullable: true,
      }),
    );

    await queryRunner.addColumn(
      'users',
      new TableColumn({
        name: 'last_weekly_reset',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('users', 'last_weekly_reset');
    await queryRunner.dropColumn('users', 'last_daily_reset');
    await queryRunner.dropColumn('users', 'weekly_invited_friends');
    await queryRunner.dropColumn('users', 'daily_invited_friends');
  }
}
