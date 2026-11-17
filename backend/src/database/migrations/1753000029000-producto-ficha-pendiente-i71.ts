import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I71: marca de "ficha técnica pendiente" en productos. Los productos
 * creados automáticamente por un ingreso de mercancía quedan marcados para
 * completar sus datos manualmente; mientras tengan la marca, la ficha
 * permite editar TODOS los campos (incluido el código provisional).
 */
export class ProductoFichaPendienteI711753000029000 implements MigrationInterface {
  name = 'ProductoFichaPendienteI711753000029000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS ficha_pendiente boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE products DROP COLUMN IF EXISTS ficha_pendiente`,
    );
  }
}
