import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I7 — Pedidos y alistamiento (EP-07, M08):
 * - orders: pedidos por empresa con consecutivo SIGLAS-#### (P-09).
 * - order_items: líneas con cantidad pedida vs. alistada (HU-030).
 * - order_counters: consecutivo independiente por empresa.
 * Los tipos de movimiento BLOQUEO_ALISTAMIENTO y LIBERACION_BLOQUEO ya
 * existen en movement_type_enum (previstos en I3).
 */
export class OrdersI71753000006000 implements MigrationInterface {
  name = 'OrdersI71753000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE order_status_enum AS ENUM (
        'ABIERTO', 'ALISTADO', 'APROBADO', 'PENDIENTE_CORRECCION', 'CANCELADO'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE orders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES companies(id),
        numero varchar(20) NOT NULL,
        orden_pedido varchar(60),
        ciudad varchar(120),
        cliente_id uuid NOT NULL REFERENCES clients(id),
        comercial_id uuid REFERENCES comerciales(id),
        notas text,
        numero_factura varchar(60),
        estado order_status_enum NOT NULL DEFAULT 'ABIERTO',
        ocr_document_id uuid REFERENCES ocr_documents(id),
        factura_ocr_document_id uuid REFERENCES ocr_documents(id),
        created_by uuid NOT NULL,
        alistado_por uuid,
        aprobado_por uuid,
        motivo_cancelacion text,
        created_at timestamptz NOT NULL DEFAULT now(),
        alistado_at timestamptz,
        aprobado_at timestamptz,
        cancelado_at timestamptz,
        UNIQUE (empresa_id, numero)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX orders_empresa_estado_idx ON orders (empresa_id, estado)`,
    );
    await queryRunner.query(
      `CREATE INDEX orders_cliente_idx ON orders (cliente_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE order_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id uuid NOT NULL REFERENCES products(id),
        codigo varchar(60) NOT NULL,
        marca varchar(120),
        descripcion varchar(250) NOT NULL,
        cantidad int NOT NULL,
        cantidad_alistada int NOT NULL DEFAULT 0,
        valor_unidad numeric(14,2) NOT NULL DEFAULT 0,
        valor_total numeric(14,2) NOT NULL DEFAULT 0,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (cantidad > 0),
        CHECK (cantidad_alistada >= 0),
        CHECK (cantidad_alistada <= cantidad)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX order_items_order_idx ON order_items (order_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX order_items_product_idx ON order_items (product_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE order_counters (
        empresa_id uuid PRIMARY KEY REFERENCES companies(id),
        ultimo int NOT NULL DEFAULT 0
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS order_counters`);
    await queryRunner.query(`DROP TABLE IF EXISTS order_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS orders`);
    await queryRunner.query(`DROP TYPE IF EXISTS order_status_enum`);
  }
}
