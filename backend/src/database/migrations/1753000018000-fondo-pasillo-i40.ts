import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I40: ubicación de productos en el fondo del pasillo.
 * La zona FONDO es un solo espacio (sin estantes); hasta ahora no había
 * forma de asociar productos a ella. Se agrega `zone_id` a las ubicaciones
 * de producto (solo se usa para zonas FONDO; rack/área/tránsito siguen
 * igual). Si la zona se elimina (reconfiguración de la bodega), sus
 * ubicaciones se borran con ella.
 */
export class FondoPasilloI401753000018000 implements MigrationInterface {
  name = 'FondoPasilloI401753000018000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE warehouse_product_locations
      ADD COLUMN IF NOT EXISTS zone_id uuid REFERENCES warehouse_zones(id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_wpl_zone" ON warehouse_product_locations (zone_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_wpl_zone"
    `);
    await queryRunner.query(`
      ALTER TABLE warehouse_product_locations DROP COLUMN IF EXISTS zone_id
    `);
  }
}
