import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I13 (B-1): despacho GLOBAL compartido por todas las empresas (spec v1.1
 * M08 §2 y M09 §3: "Los consecutivos de despacho y de caja son únicos y
 * compartidos para todas las empresas").
 *
 * - dispatch_counters pasa de serie por empresa a contador global (id=1),
 *   sembrado en el máximo ya alcanzado para no reutilizar números.
 * - dispatches.empresa_id queda nullable (la membresía por empresa vive en
 *   dispatch_orders.empresa_id, que es la que usan los filtros HU-054).
 * - La unicidad del número es global: UNIQUE(numero).
 * - Los números históricos (IRE-0001…) no se tocan; los nuevos son DES-######.
 */
export class DespachoGlobalI131753000011000 implements MigrationInterface {
  name = 'DespachoGlobalI131753000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Secuencia global: nextval() es no-transaccional por diseño en PG —
    // jamás duplica aunque la transacción del despacho haga rollback (puede
    // dejar huecos, aceptable). Arranca en el máximo alcanzado + 1.
    await queryRunner.query(`CREATE SEQUENCE IF NOT EXISTS dispatch_numero_seq`);
    await queryRunner.query(`
      SELECT setval(
        'dispatch_numero_seq',
        GREATEST((SELECT COALESCE(MAX(ultimo), 0) FROM dispatch_counters), 1),
        (SELECT COALESCE(MAX(ultimo), 0) FROM dispatch_counters) > 0
      )
    `);

    // empresa_id ya no es obligatoria: el despacho es global
    await queryRunner.query(
      `ALTER TABLE dispatches ALTER COLUMN empresa_id DROP NOT NULL`,
    );

    // Unicidad global del número (reemplaza UNIQUE(empresa_id, numero))
    await queryRunner.query(`
      ALTER TABLE dispatches DROP CONSTRAINT IF EXISTS dispatches_empresa_id_numero_key
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS dispatches_numero_uq ON dispatches (numero)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS dispatches_numero_uq`);
    await queryRunner.query(`
      ALTER TABLE dispatches ADD CONSTRAINT dispatches_empresa_id_numero_key UNIQUE (empresa_id, numero)
    `);
    await queryRunner.query(
      `ALTER TABLE dispatches ALTER COLUMN empresa_id SET NOT NULL`,
    );
    await queryRunner.query(`DROP SEQUENCE IF EXISTS dispatch_numero_seq`);
  }
}
