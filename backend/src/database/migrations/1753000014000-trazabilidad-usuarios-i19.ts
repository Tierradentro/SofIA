import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I19: trazabilidad de usuario en el ciclo completo del despacho.
 * El pedido ya registra creador/alistador/aprobador (created_by,
 * alistado_por/at, aprobado_por/at); al despacho le faltaba quién
 * registró la salida (despachado_por — despachado_at ya existía).
 */
export class TrazabilidadUsuariosI191753000014000 implements MigrationInterface {
  name = 'TrazabilidadUsuariosI191753000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dispatches
      ADD COLUMN IF NOT EXISTS despachado_por uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE dispatches
      DROP COLUMN IF EXISTS despachado_por
    `);
  }
}
