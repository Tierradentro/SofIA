import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I41: los productos tienen foto (visible en las tarjetas de consulta y en
 * la ficha). La imagen se almacena como documento FOTO_PRODUCTO y el
 * producto referencia el documento vigente.
 */
export class ProductoFotoI411753000020000 implements MigrationInterface {
  name = 'ProductoFotoI411753000020000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE document_type_enum ADD VALUE IF NOT EXISTS 'FOTO_PRODUCTO'`,
    );
    await queryRunner.query(
      `ALTER TABLE products
         ADD COLUMN IF NOT EXISTS foto_document_id uuid
         REFERENCES documents(id) ON DELETE SET NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products DROP COLUMN IF EXISTS foto_document_id`,
    );
    // Los valores de un enum no se pueden eliminar en PostgreSQL; el valor
    // FOTO_PRODUCTO queda sin uso tras el down (inofensivo).
  }
}
