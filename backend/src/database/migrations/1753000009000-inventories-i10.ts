import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I10 — Inventarios por empresa (EP-09, M12, HU-048..052):
 * - stock_counts: jornada de inventario de UNA empresa (nunca mezcla
 *   productos, HU-048), con consecutivo INV-SIGLAS-#### por empresa.
 * - stock_count_items: snapshot de existencia al crear (la comparación del
 *   conteo es contra ese snapshot), conteo físico con ubicación (HU-049),
 *   diferencia calculada (HU-050) y nota del Generador por diferencia (HU-051).
 * El ajuste de existencias se aplica como movimientos AJUSTE_INVENTARIO
 * (D-01; el tipo ya existe desde I3).
 */
export class InventoriesI101753000009000 implements MigrationInterface {
  name = 'InventoriesI101753000009000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE stock_count_status_enum AS ENUM ('EN_CONTEO', 'PENDIENTE_APROBACION', 'APROBADO', 'CANCELADO')`,
    );

    await queryRunner.query(`
      CREATE TABLE stock_counts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES companies(id),
        numero varchar(20) NOT NULL,
        instruccion text NOT NULL,
        estado stock_count_status_enum NOT NULL DEFAULT 'EN_CONTEO',
        created_by uuid NOT NULL,
        cerrado_por uuid,
        aprobado_por uuid,
        motivo_cancelacion text,
        created_at timestamptz NOT NULL DEFAULT now(),
        cerrado_at timestamptz,
        aprobado_at timestamptz,
        cancelado_at timestamptz,
        UNIQUE (empresa_id, numero)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX stock_counts_empresa_estado_idx ON stock_counts (empresa_id, estado)`,
    );

    await queryRunner.query(`
      CREATE TABLE stock_count_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        count_id uuid NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        codigo varchar(60) NOT NULL,
        descripcion varchar(250) NOT NULL,
        existencia_snapshot int NOT NULL,
        precio_snapshot numeric(14,2) NOT NULL DEFAULT 0,
        conteo int,
        ubicacion varchar(60),
        nota_diferencia text,
        contado_por uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        contado_at timestamptz,
        UNIQUE (count_id, product_id),
        CHECK (conteo IS NULL OR conteo >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX stock_count_items_count_idx ON stock_count_items (count_id)`,
    );

    // Consecutivo de jornadas por empresa (INV-SIGLAS-####)
    await queryRunner.query(`
      CREATE TABLE inventory_counters (
        empresa_id uuid PRIMARY KEY REFERENCES companies(id),
        ultimo int NOT NULL DEFAULT 0
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inventory_counters`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_count_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS stock_counts`);
    await queryRunner.query(`DROP TYPE IF EXISTS stock_count_status_enum`);
  }
}
