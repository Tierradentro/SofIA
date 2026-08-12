import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * QA Func. 4.1 (I15): multi-dirección de clientes.
 *
 * - Nueva tabla client_addresses (hasta 10 por cliente, una principal).
 * - Migración de la dirección histórica de clients.direccion como
 *   dirección principal de cada cliente que la tenga.
 * - orders.direccion_despacho: la dirección elegida en el pedido (foto).
 * - dispatches.direccion_despacho: ajustable en el despacho antes de salir.
 */
export class DireccionesI151753000013000 implements MigrationInterface {
  name = 'DireccionesI151753000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS client_addresses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        direccion varchar(250) NOT NULL,
        ciudad varchar(120),
        es_principal boolean NOT NULL DEFAULT false,
        activo boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS client_addresses_client_idx ON client_addresses (client_id)
    `);
    // Una sola principal por cliente
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS client_addresses_principal_uq
      ON client_addresses (client_id) WHERE es_principal
    `);

    // La dirección histórica del cliente migra como su principal
    await queryRunner.query(`
      INSERT INTO client_addresses (client_id, direccion, ciudad, es_principal)
      SELECT id, direccion, ciudad, true
      FROM clients
      WHERE direccion IS NOT NULL AND btrim(direccion) <> ''
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS direccion_despacho varchar(250)
    `);
    await queryRunner.query(`
      ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS direccion_despacho varchar(250)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE dispatches DROP COLUMN IF EXISTS direccion_despacho`);
    await queryRunner.query(`ALTER TABLE orders DROP COLUMN IF EXISTS direccion_despacho`);
    await queryRunner.query(`DROP TABLE IF EXISTS client_addresses`);
  }
}
