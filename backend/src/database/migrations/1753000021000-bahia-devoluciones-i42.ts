import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I42: bahía de devoluciones. La mercancía aceptada al inventario desde un
 * caso PQRS se ingresa físicamente en una bahía de este tipo (área con
 * permite_productos = true), configurable desde el módulo de bodega.
 */
export class BahiaDevolucionesI421753000021000 implements MigrationInterface {
  name = 'BahiaDevolucionesI421753000021000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE warehouse_area_tipo_enum ADD VALUE IF NOT EXISTS 'BAHIA_DEVOLUCIONES'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres no retira valores de un enum; el valor extra es inofensivo
    // (no se crean áreas de ese tipo si el código vuelve atrás).
  }
}
