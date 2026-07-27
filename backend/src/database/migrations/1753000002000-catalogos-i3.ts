import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración I3 — Catálogos (EP-03): clients, comerciales, products,
 * product_barcodes, inventory_movements.
 * Incluye:
 *  - Extensión pg_trgm e índice GIN sobre products.descripcion (regla transversal).
 *  - B-tree sobre codigo, codigo_oe, ref_cruzada_1, ref_cruzada_2.
 *  - UNIQUE(empresa_id, codigo): las existencias nunca se mezclan.
 *  - CHECK cantidad_bloqueada <= cantidad y no negativos.
 *  - Barcode único global y 1:1 por producto.
 *  - FK users.comercial_id -> comerciales.id (M06).
 */
export class CatalogosI31753000002000 implements MigrationInterface {
  name = 'CatalogosI31753000002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(
      `CREATE TYPE "product_status_enum" AS ENUM ('ACTIVO','INCOMPLETO','INACTIVO')`,
    );
    await queryRunner.query(
      `CREATE TYPE "barcode_origin_enum" AS ENUM ('ESCANEADO','MANUAL')`,
    );
    await queryRunner.query(
      `CREATE TYPE "movement_type_enum" AS ENUM ('INGRESO_APROBADO','BLOQUEO_ALISTAMIENTO','LIBERACION_BLOQUEO','DESPACHO_CIERRE_CAJA','AJUSTE_INVENTARIO','AJUSTE_IMPORTACION','REINGRESO_DEVOLUCION','CORRECCION_ADMIN')`,
    );

    // ---- clients (M04, global) ----
    await queryRunner.query(`
      CREATE TABLE "clients" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "nombre" character varying(200) NOT NULL,
        "identificacion" character varying(60),
        "direccion" character varying(250),
        "telefonos" character varying(120),
        "ciudad" character varying(120),
        "activo" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_clients" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_clients_nombre" ON "clients" ("nombre")`,
    );

    // ---- comerciales (M06, global) ----
    await queryRunner.query(`
      CREATE TABLE "comerciales" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "nombre" character varying(200) NOT NULL,
        "identificacion" character varying(60),
        "direccion" character varying(250),
        "telefonos" character varying(120),
        "ciudad" character varying(120),
        "activo" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_comerciales" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_comerciales_nombre" ON "comerciales" ("nombre")`,
    );

    // ---- users.comercial_id -> comerciales (M06) ----
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD CONSTRAINT "FK_users_comercial" FOREIGN KEY ("comercial_id")
      REFERENCES "comerciales"("id") ON DELETE SET NULL
    `);

    // ---- products (M05, por empresa) ----
    await queryRunner.query(`
      CREATE TABLE "products" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "empresa_id" uuid NOT NULL,
        "codigo" character varying(60) NOT NULL,
        "descripcion" character varying(250) NOT NULL,
        "proveedor" character varying(150),
        "marca" character varying(120),
        "vehiculo" character varying(120),
        "categoria" character varying(120),
        "subcategoria" character varying(120),
        "observaciones" text,
        "aplicacion" character varying(250),
        "codigo_oe" character varying(60),
        "ref_cruzada_1" character varying(60),
        "ref_cruzada_2" character varying(60),
        "unidad_medida" character varying(30),
        "cantidad" integer NOT NULL DEFAULT 0,
        "cantidad_bloqueada" integer NOT NULL DEFAULT 0,
        "precio" numeric(14,2) NOT NULL DEFAULT 0,
        "estado" "product_status_enum" NOT NULL DEFAULT 'ACTIVO',
        "link_imagen" character varying(500),
        "ubicacion" character varying(120),
        "grupo_siete" character varying(60),
        "grupo_ocho" character varying(60),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_products" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_products_empresa_codigo" UNIQUE ("empresa_id", "codigo"),
        CONSTRAINT "FK_products_empresa" FOREIGN KEY ("empresa_id")
          REFERENCES "companies"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_products_cantidad" CHECK ("cantidad" >= 0),
        CONSTRAINT "CHK_products_bloqueada" CHECK ("cantidad_bloqueada" >= 0),
        CONSTRAINT "CHK_products_bloqueada_lte" CHECK ("cantidad_bloqueada" <= "cantidad")
      )
    `);
    // B-tree: codigo, codigo_oe, refs cruzadas (regla transversal)
    await queryRunner.query(`CREATE INDEX "IDX_products_codigo" ON "products" ("codigo")`);
    await queryRunner.query(`CREATE INDEX "IDX_products_empresa" ON "products" ("empresa_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_products_oe" ON "products" ("codigo_oe")`);
    await queryRunner.query(`CREATE INDEX "IDX_products_ref1" ON "products" ("ref_cruzada_1")`);
    await queryRunner.query(`CREATE INDEX "IDX_products_ref2" ON "products" ("ref_cruzada_2")`);
    // pg_trgm GIN: descripcion (criterio de búsqueda predominante)
    await queryRunner.query(
      `CREATE INDEX "IDX_products_descripcion_trgm" ON "products" USING GIN ("descripcion" gin_trgm_ops)`,
    );

    // ---- product_barcodes (D-02: único global, 1:1) ----
    await queryRunner.query(`
      CREATE TABLE "product_barcodes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "barcode" character varying(120) NOT NULL,
        "product_id" uuid NOT NULL,
        "origen" "barcode_origin_enum" NOT NULL,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_barcodes" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_product_barcodes_barcode" UNIQUE ("barcode"),
        CONSTRAINT "UQ_product_barcodes_product" UNIQUE ("product_id"),
        CONSTRAINT "FK_product_barcodes_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE CASCADE
      )
    `);

    // ---- inventory_movements (D-01: libro mayor) ----
    await queryRunner.query(`
      CREATE TABLE "inventory_movements" (
        "id" BIGSERIAL,
        "empresa_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "tipo" "movement_type_enum" NOT NULL,
        "cantidad_delta" integer NOT NULL,
        "cantidad_bloqueada_delta" integer NOT NULL,
        "cantidad_resultante" integer NOT NULL,
        "bloqueada_resultante" integer NOT NULL,
        "doc_tipo" character varying(40),
        "doc_id" character varying(80),
        "usuario_id" uuid,
        "fecha" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_movements" PRIMARY KEY ("id"),
        CONSTRAINT "FK_movements_product" FOREIGN KEY ("product_id")
          REFERENCES "products"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_movements_product_fecha" ON "inventory_movements" ("product_id", "fecha")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_movements_empresa" ON "inventory_movements" ("empresa_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_movements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_barcodes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "products"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "FK_users_comercial"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "comerciales"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "clients"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "movement_type_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "barcode_origin_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "product_status_enum"`);
  }
}
