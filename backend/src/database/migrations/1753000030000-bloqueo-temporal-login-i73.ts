import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I73 (auditoría #6): el bloqueo por intentos fallidos deja de ser
 * permanente — se desbloquea solo pasado un tiempo (15 min por defecto).
 * bloqueado_hasta guarda el instante en que expira el bloqueo temporal.
 */
export class BloqueoTemporalLoginI731753000030000 implements MigrationInterface {
  name = 'BloqueoTemporalLoginI731753000030000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS bloqueado_hasta timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS bloqueado_hasta`,
    );
  }
}
