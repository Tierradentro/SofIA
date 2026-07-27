import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I8 — Despachos y cajas (EP-08, M09 + M10):
 * - dispatches: consecutivo SIGLAS-#### por empresa (serie propia), consolida
 *   pedidos del mismo cliente (multiempresa, HU-034).
 * - dispatch_orders: pedidos asociados (un pedido solo en un despacho activo).
 * - boxes: CJA-###### global (único para todas las empresas, contenido del QR).
 * - box_items: conteo por escaneo con trazabilidad por empresa/pedido.
 * - order_items.cantidad_despachada: acumulado despachado por línea de pedido.
 * El tipo de movimiento DESPACHO_CIERRE_CAJA ya existe (previsto en I3).
 */
export class DispatchesI81753000007000 implements MigrationInterface {
  name = 'DispatchesI81753000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE dispatch_status_enum AS ENUM (
        'CREADO', 'ABIERTO', 'PENDIENTE_CORRECCION', 'PARCIAL', 'DESPACHADO', 'CANCELADO'
      )
    `);
    await queryRunner.query(`CREATE TYPE transport_type_enum AS ENUM ('EXTERNA', 'INTERNA')`);
    await queryRunner.query(`CREATE TYPE box_status_enum AS ENUM ('ABIERTA', 'CERRADA')`);

    await queryRunner.query(`
      CREATE TABLE dispatches (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES companies(id),
        numero varchar(20) NOT NULL,
        cliente_id uuid NOT NULL REFERENCES clients(id),
        estado dispatch_status_enum NOT NULL DEFAULT 'CREADO',
        empaque_finalizado boolean NOT NULL DEFAULT false,
        parcial_motivo text,
        parcial_aprobado_por uuid,
        parcial_aprobado_at timestamptz,
        tipo_transporte transport_type_enum,
        carrier_id uuid REFERENCES carriers(id),
        guia varchar(60),
        nombre_transporte varchar(150),
        fecha_salida timestamptz,
        despacho_origen_id uuid REFERENCES dispatches(id),
        created_by uuid NOT NULL,
        aprobado_por uuid,
        motivo_cancelacion text,
        created_at timestamptz NOT NULL DEFAULT now(),
        despachado_at timestamptz,
        cancelado_at timestamptz,
        UNIQUE (empresa_id, numero)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX dispatches_estado_idx ON dispatches (estado)`,
    );
    await queryRunner.query(
      `CREATE INDEX dispatches_cliente_idx ON dispatches (cliente_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE dispatch_orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        dispatch_id uuid NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
        order_id uuid NOT NULL REFERENCES orders(id),
        empresa_id uuid NOT NULL REFERENCES companies(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (dispatch_id, order_id)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX dispatch_orders_order_idx ON dispatch_orders (order_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE boxes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        box_id varchar(20) NOT NULL UNIQUE,
        dispatch_id uuid NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
        numero_en_despacho int NOT NULL,
        estado box_status_enum NOT NULL DEFAULT 'ABIERTA',
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        cerrada_at timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX boxes_dispatch_idx ON boxes (dispatch_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE box_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        box_id uuid NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
        order_item_id uuid NOT NULL REFERENCES order_items(id),
        product_id uuid NOT NULL REFERENCES products(id),
        empresa_id uuid NOT NULL REFERENCES companies(id),
        codigo varchar(60) NOT NULL,
        cantidad int NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (box_id, order_item_id),
        CHECK (cantidad >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX box_items_box_idx ON box_items (box_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE dispatch_counters (
        empresa_id uuid PRIMARY KEY REFERENCES companies(id),
        ultimo int NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`
      CREATE TABLE box_counter (
        id int PRIMARY KEY,
        ultimo int NOT NULL DEFAULT 0
      )
    `);
    await queryRunner.query(`INSERT INTO box_counter (id, ultimo) VALUES (1, 0)`);

    // Acumulado despachado por línea de pedido (para pendientes D-06)
    await queryRunner.query(`
      ALTER TABLE order_items
      ADD COLUMN cantidad_despachada int NOT NULL DEFAULT 0,
      ADD CONSTRAINT order_items_despachada_check
        CHECK (cantidad_despachada >= 0 AND cantidad_despachada <= cantidad_alistada)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_despachada_check`,
    );
    await queryRunner.query(
      `ALTER TABLE order_items DROP COLUMN IF EXISTS cantidad_despachada`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS box_counter`);
    await queryRunner.query(`DROP TABLE IF EXISTS dispatch_counters`);
    await queryRunner.query(`DROP TABLE IF EXISTS box_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS boxes`);
    await queryRunner.query(`DROP TABLE IF EXISTS dispatch_orders`);
    await queryRunner.query(`DROP TABLE IF EXISTS dispatches`);
    await queryRunner.query(`DROP TYPE IF EXISTS box_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS transport_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS dispatch_status_enum`);
  }
}
