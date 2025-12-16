import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddServiceCooldown1732548001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add cooldown_days column to services table
    await queryRunner.addColumn(
      'services',
      new TableColumn({
        name: 'cooldown_days',
        type: 'integer',
        default: 0,
        isNullable: false,
      }),
    );

    // Add last_used_at column to user_services table
    await queryRunner.addColumn(
      'user_services',
      new TableColumn({
        name: 'last_used_at',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('services', 'cooldown_days');
    await queryRunner.dropColumn('user_services', 'last_used_at');
  }
}
