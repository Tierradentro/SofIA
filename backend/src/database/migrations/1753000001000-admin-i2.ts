import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración I2 — Administración y parámetros (EP-02, M17).
 * Tablas: carriers (HU-008), api_keys (M17), documents (D-07, soporte logo HU-006).
 */
export class AdminI21753000001000 implements MigrationInterface {
  name = 'AdminI21753000001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "carrier_type_enum" AS ENUM ('EXTERNA','INTERNA')`,
    );
    await queryRunner.query(
      `CREATE TYPE "document_type_enum" AS ENUM ('FACTURA_IMPORTACION','ORDEN_PEDIDO','COTIZACION','FACTURA_VENTA','GUIA_TRANSPORTE','SOPORTE_PQRS','LOGO')`,
    );

    await queryRunner.query(`
      CREATE TABLE "carriers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "nombre" character varying(150) NOT NULL,
        "tipo" "carrier_type_enum" NOT NULL,
        "identificacion" character varying(60),
        "telefonos" character varying(120),
        "activo" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_carriers" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_carriers_nombre" UNIQUE ("nombre")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "api_keys" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "nombre" character varying(120) NOT NULL,
        "key_hash" character varying(64) NOT NULL,
        "key_prefix" character varying(12) NOT NULL,
        "activo" boolean NOT NULL DEFAULT true,
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_api_keys" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_api_keys_hash" UNIQUE ("key_hash"),
        CONSTRAINT "FK_api_keys_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_api_keys_user" ON "api_keys" ("user_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "owner_type" character varying(60) NOT NULL,
        "owner_id" character varying(80),
        "tipo" "document_type_enum" NOT NULL,
        "path" character varying(500) NOT NULL,
        "nombre_original" character varying(250) NOT NULL,
        "mime" character varying(120) NOT NULL,
        "size" bigint NOT NULL,
        "es_temporal" boolean NOT NULL DEFAULT true,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_documents" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_documents_owner" ON "documents" ("owner_type", "owner_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "documents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "api_keys"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "carriers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "document_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "carrier_type_enum"`);
  }
}
