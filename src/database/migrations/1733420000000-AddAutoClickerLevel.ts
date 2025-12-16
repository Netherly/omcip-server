import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAutoClickerLevel1733420000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add level column to user_services table for auto-clicker tracking
    await queryRunner.addColumn(
      'user_services',
      new TableColumn({
        name: 'level',
        type: 'integer',
        default: 0,
        isNullable: false,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('user_services', 'level');
  }
}
