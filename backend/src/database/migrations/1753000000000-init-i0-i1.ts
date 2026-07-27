import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración inicial — Iteraciones I0 + I1.
 * Tablas: companies, users, system_params, audit_logs, pqrs_reasons.
 * Incluye el mecanismo append-only de auditoría:
 *  - Función + trigger BEFORE UPDATE OR DELETE que bloquea modificaciones.
 *  - La purga administrativa (A-03) habilita el bypass con
 *    SET LOCAL audit.allow_purge = 'on' dentro de una transacción
 *    controlada, siempre con exportación previa y auto-auditoría.
 */
export class InitI0I11753000000000 implements MigrationInterface {
  name = 'InitI0I11753000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- ENUMs ----
    await queryRunner.query(
      `CREATE TYPE "user_role_enum" AS ENUM ('OPERADOR','GENERADOR','ADMINISTRADOR','COMERCIAL','API')`,
    );
    await queryRunner.query(
      `CREATE TYPE "user_status_enum" AS ENUM ('ACTIVO','BLOQUEADO','CANCELADO')`,
    );
    await queryRunner.query(
      `CREATE TYPE "pqrs_concept_enum" AS ENUM ('GARANTIA','GARANTIA_NO_APLICA')`,
    );

    // ---- companies (M03; siglas para consecutivo de pedido SIGLAS-####, P-09) ----
    await queryRunner.query(`
      CREATE TABLE "companies" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "nombre" character varying(150) NOT NULL,
        "siglas" character varying(5) NOT NULL,
        "descripcion" character varying(250),
        "identificacion" character varying(60),
        "direccion" character varying(250),
        "telefonos" character varying(120),
        "ciudad" character varying(120),
        "activo" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_companies" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_companies_nombre" UNIQUE ("nombre"),
        CONSTRAINT "UQ_companies_siglas" UNIQUE ("siglas")
      )
    `);

    // ---- users (M02) ----
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "nombre" character varying(150) NOT NULL,
        "descripcion" character varying(150) NOT NULL DEFAULT '',
        "username" character varying(60) NOT NULL,
        "email" character varying(150) NOT NULL,
        "password_hash" character varying(100) NOT NULL,
        "rol" "user_role_enum" NOT NULL,
        "estado" "user_status_enum" NOT NULL DEFAULT 'ACTIVO',
        "fecha_creacion" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "fecha_clave" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "debe_cambiar_clave" boolean NOT NULL DEFAULT true,
        "intentos_fallidos" integer NOT NULL DEFAULT 0,
        "comercial_id" uuid,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    // ---- system_params (M14) ----
    await queryRunner.query(`
      CREATE TABLE "system_params" (
        "clave" character varying(100) NOT NULL,
        "valor" jsonb NOT NULL,
        "descripcion" character varying(250),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_system_params" PRIMARY KEY ("clave")
      )
    `);

    // ---- audit_logs (M15) ----
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" BIGSERIAL,
        "usuario_id" uuid,
        "usuario_username" character varying(60),
        "fecha_hora" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "accion" character varying(60) NOT NULL,
        "tabla" character varying(60) NOT NULL,
        "registro_id" character varying(80),
        "valor_anterior" jsonb,
        "valor_nuevo" jsonb,
        "motivo" text,
        CONSTRAINT "PK_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_tabla_registro" ON "audit_logs" ("tabla", "registro_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_usuario" ON "audit_logs" ("usuario_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_fecha" ON "audit_logs" ("fecha_hora")`,
    );

    // ---- pqrs_reasons (Spec §6, seed en I0) ----
    await queryRunner.query(`
      CREATE TABLE "pqrs_reasons" (
        "codigo" character varying(4) NOT NULL,
        "concepto" "pqrs_concept_enum" NOT NULL,
        "descripcion" character varying(150) NOT NULL,
        CONSTRAINT "PK_pqrs_reasons" PRIMARY KEY ("codigo")
      )
    `);

    // ---- Append-only de auditoría ----
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_block_modification() RETURNS trigger AS $$
      BEGIN
        IF current_setting('audit.allow_purge', true) = 'on' THEN
          IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
        END IF;
        RAISE EXCEPTION 'audit_logs es append-only: % prohibido. Use la purga administrativa controlada.', TG_OP;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_logs_append_only
      BEFORE UPDATE OR DELETE ON "audit_logs"
      FOR EACH ROW EXECUTE FUNCTION audit_block_modification()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_audit_logs_append_only ON "audit_logs"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS audit_block_modification()`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "pqrs_reasons"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "system_params"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "companies"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pqrs_concept_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "user_role_enum"`);
  }
}
