import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I13 (H-7/H-4, spec §7): procedencia del pedido para la API externa.
 * created_via distingue MANUAL / OCR / EXCEL / API; el PUT /api/orders/{id}
 * solo puede modificar pedidos ABIERTOS creados por esta vía.
 */
export class ApiExternaI131753000012000 implements MigrationInterface {
  name = 'ApiExternaI131753000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS created_via varchar(10) NOT NULL DEFAULT 'MANUAL'
    `);
    await queryRunner.query(`
      ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_created_via_check
    `);
    await queryRunner.query(`
      ALTER TABLE orders ADD CONSTRAINT orders_created_via_check
      CHECK (created_via IN ('MANUAL', 'OCR', 'EXCEL', 'API'))
    `);
    // Backfill: pedidos nacidos de un documento OCR
    await queryRunner.query(`
      UPDATE orders SET created_via = 'OCR' WHERE ocr_document_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_created_via_check`,
    );
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN IF EXISTS created_via`);
  }
}
