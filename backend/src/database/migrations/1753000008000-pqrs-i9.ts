import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I9 — Devoluciones (PQRS) (EP-08, M11, HU-043..047):
 * - pqrs_cases: caso de devolución con campos M11 (cliente, comercial,
 *   código/marca/descripción, cantidad, factura, motivo, detalle,
 *   descripción/solución del caso, documento, notas, prioridad, estado).
 *   Asociaciones opcionales a pedido/despacho/caja (HU-044, CU-006/007).
 * - pqrs_supports: soportes fotográficos con observación (HU-046) y
 *   soportes de respuesta del proveedor (M11 Solución).
 * El catálogo de motivos (pqrs_reasons G01–G40/N01–N18) ya existe desde I0.
 */
export class PqrsI91753000008000 implements MigrationInterface {
  name = 'PqrsI91753000008000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE pqrs_status_enum AS ENUM ('ABIERTA', 'PENDIENTE_CORRECCION', 'CERRADA', 'CANCELADA')`,
    );
    await queryRunner.query(
      `CREATE TYPE pqrs_priority_enum AS ENUM ('ALTA', 'MEDIA', 'BAJA')`,
    );
    await queryRunner.query(
      `CREATE TYPE pqrs_support_type_enum AS ENUM ('RECEPCION', 'SOLUCION')`,
    );

    await queryRunner.query(`
      CREATE TABLE pqrs_cases (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        cliente_id uuid NOT NULL REFERENCES clients(id),
        comercial_id uuid REFERENCES comerciales(id),
        product_id uuid NOT NULL REFERENCES products(id),
        codigo varchar(60) NOT NULL,
        marca varchar(120),
        descripcion varchar(250) NOT NULL,
        cantidad int NOT NULL DEFAULT 1,
        factura varchar(60),
        factura_manual boolean NOT NULL DEFAULT false,
        factura_observacion text,
        motivo_codigo varchar(4) NOT NULL REFERENCES pqrs_reasons(codigo),
        detalle text,
        descripcion_caso text NOT NULL,
        solucion_caso text,
        documento varchar(60),
        notas text,
        prioridad pqrs_priority_enum NOT NULL DEFAULT 'MEDIA',
        estado pqrs_status_enum NOT NULL DEFAULT 'ABIERTA',
        order_id uuid REFERENCES orders(id),
        dispatch_id uuid REFERENCES dispatches(id),
        box_id varchar(20),
        cantidad_reingresada int NOT NULL DEFAULT 0,
        created_by uuid NOT NULL,
        corregido_por uuid,
        cerrado_por uuid,
        motivo_cancelacion text,
        created_at timestamptz NOT NULL DEFAULT now(),
        cerrada_at timestamptz,
        cancelado_at timestamptz,
        CHECK (cantidad > 0),
        CHECK (cantidad_reingresada >= 0 AND cantidad_reingresada <= cantidad)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX pqrs_cases_estado_idx ON pqrs_cases (estado)`,
    );
    await queryRunner.query(
      `CREATE INDEX pqrs_cases_cliente_idx ON pqrs_cases (cliente_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX pqrs_cases_factura_idx ON pqrs_cases (factura)`,
    );

    await queryRunner.query(`
      CREATE TABLE pqrs_supports (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id uuid NOT NULL REFERENCES pqrs_cases(id) ON DELETE CASCADE,
        document_id uuid NOT NULL REFERENCES documents(id),
        tipo pqrs_support_type_enum NOT NULL DEFAULT 'RECEPCION',
        observacion text,
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX pqrs_supports_case_idx ON pqrs_supports (case_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS pqrs_supports`);
    await queryRunner.query(`DROP TABLE IF EXISTS pqrs_cases`);
    await queryRunner.query(`DROP TYPE IF EXISTS pqrs_support_type_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS pqrs_priority_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS pqrs_status_enum`);
  }
}
