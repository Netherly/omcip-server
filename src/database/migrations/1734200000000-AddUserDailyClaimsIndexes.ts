import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDailyClaimsIndexes1734200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Add composite index for efficient queries by user_id and claimed_at
    // This is the most critical index - used by getCurrentLoginStreak(), getLoginRewards(), claimLoginReward()
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_user_daily_claims_user_claimed 
      ON user_daily_claims(user_id, claimed_at DESC);
    `);

    // 2. Add unique constraint to prevent duplicate claims on the same day
    // Protects against race conditions between completeLoginClaimTask() and claimLoginReward()
    // NOTE: Using CAST to DATE to ensure uniqueness per calendar day
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_user_daily_claims_unique_per_day 
      ON user_daily_claims(user_id, CAST(claimed_at AS DATE), day_number);
    `);

    // 3. Add foreign key constraint if it doesn't exist
    // Ensures referential integrity - claims are deleted when user is deleted
    const hasForeignKey = await queryRunner.query(`
      SELECT COUNT(*) as count
      FROM information_schema.table_constraints
      WHERE constraint_type = 'FOREIGN KEY'
        AND table_name = 'user_daily_claims'
        AND constraint_name = 'fk_user_daily_claims_user_id';
    `);

    if (parseInt(hasForeignKey[0].count) === 0) {
      await queryRunner.query(`
        ALTER TABLE user_daily_claims
        ADD CONSTRAINT fk_user_daily_claims_user_id
        FOREIGN KEY (user_id) REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE;
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_user_daily_claims_unique_per_day;
    `);
    
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_user_daily_claims_user_claimed;
    `);

    // Drop foreign key constraint
    await queryRunner.query(`
      ALTER TABLE user_daily_claims
      DROP CONSTRAINT IF EXISTS fk_user_daily_claims_user_id;
    `);
  }
}
