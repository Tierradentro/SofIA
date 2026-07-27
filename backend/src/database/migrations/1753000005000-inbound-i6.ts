import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I6 — Ingreso de mercancía (EP-06, M07):
 * - inbound_receipts: actividades de ingreso por empresa (HU-022).
 * - inbound_items: líneas facturadas vs. recibidas (HU-024).
 * El tipo de movimiento INGRESO_APROBADO ya existe en movement_type_enum
 * (previsto en I3), no requiere ALTER.
 */
export class InboundI61753000005000 implements MigrationInterface {
  name = 'InboundI61753000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE inbound_status_enum AS ENUM (
        'CREADO', 'EN_INGRESO', 'PENDIENTE_CORRECCION', 'APROBADO', 'CANCELADO'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE inbound_receipts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id uuid NOT NULL REFERENCES companies(id),
        numero_factura varchar(60),
        fecha_factura date,
        proveedor varchar(200),
        estado inbound_status_enum NOT NULL DEFAULT 'CREADO',
        caja_principal varchar(80),
        ocr_document_id uuid REFERENCES ocr_documents(id),
        conteo_cerrado boolean NOT NULL DEFAULT false,
        observacion_diferencias text,
        created_by uuid NOT NULL,
        iniciado_por uuid,
        aprobado_por uuid,
        motivo_cancelacion text,
        created_at timestamptz NOT NULL DEFAULT now(),
        iniciado_at timestamptz,
        aprobado_at timestamptz,
        cancelado_at timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX inbound_receipts_empresa_estado_idx ON inbound_receipts (empresa_id, estado)`,
    );

    await queryRunner.query(`
      CREATE TABLE inbound_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_id uuid NOT NULL REFERENCES inbound_receipts(id) ON DELETE CASCADE,
        referencia varchar(60) NOT NULL,
        descripcion varchar(250),
        unidad varchar(30) NOT NULL DEFAULT 'UND',
        cantidad_facturada int NOT NULL,
        cantidad_recibida int NOT NULL DEFAULT 0,
        product_id uuid REFERENCES products(id),
        es_nuevo boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (cantidad_facturada >= 0),
        CHECK (cantidad_recibida >= 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX inbound_items_receipt_idx ON inbound_items (receipt_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS inbound_items`);
    await queryRunner.query(`DROP TABLE IF EXISTS inbound_receipts`);
    await queryRunner.query(`DROP TYPE IF EXISTS inbound_status_enum`);
  }
}
