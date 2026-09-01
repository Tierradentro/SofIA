import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I35: áreas configurables de la bodega.
 * - Cada cajón de área admite color propio (columna `color`).
 * - Un piso puede tener varias áreas del mismo tipo: se elimina la unicidad
 *   (floor_id, tipo) para permitir bahías/patios/entradas adicionales.
 */
export class AreasConfigurablesI351753000017000 implements MigrationInterface {
  name = 'AreasConfigurablesI351753000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE warehouse_areas ADD COLUMN IF NOT EXISTS color varchar(30)
    `);
    // El nombre del constraint depende de si la tabla vino de la migración
    // (warehouse_areas_floor_id_tipo_key) o de synchronize (UQ_...).
    await queryRunner.query(`
      ALTER TABLE warehouse_areas DROP CONSTRAINT IF EXISTS "warehouse_areas_floor_id_tipo_key"
    `);
    await queryRunner.query(`
      ALTER TABLE warehouse_areas DROP CONSTRAINT IF EXISTS "UQ_warehouse_areas_floor_tipo"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE warehouse_areas DROP COLUMN IF EXISTS color
    `);
    await queryRunner.query(`
      ALTER TABLE warehouse_areas
      ADD CONSTRAINT "warehouse_areas_floor_id_tipo_key" UNIQUE (floor_id, tipo)
    `);
  }
}
