import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migración I4 — Integración contable (EP-04, M18): tabla import_jobs.
 */
export class ImportsI41753000003000 implements MigrationInterface {
  name = 'ImportsI41753000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "import_type_enum" AS ENUM ('PRODUCTOS','CANTIDADES','CLIENTES','COMERCIALES')`,
    );
    await queryRunner.query(
      `CREATE TYPE "import_job_status_enum" AS ENUM ('VALIDANDO','PENDIENTE_APROBACION','APLICADO','RECHAZADO')`,
    );
    await queryRunner.query(`
      CREATE TABLE "import_jobs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tipo" "import_type_enum" NOT NULL,
        "empresa_id" uuid,
        "document_id" uuid,
        "nombre_archivo" character varying(250) NOT NULL,
        "mapeo" jsonb NOT NULL,
        "resumen" jsonb,
        "estado" "import_job_status_enum" NOT NULL DEFAULT 'VALIDANDO',
        "created_by" uuid,
        "aprobado_por" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_import_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_import_jobs_empresa" FOREIGN KEY ("empresa_id")
          REFERENCES "companies"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_import_jobs_tipo" ON "import_jobs" ("tipo")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "import_jobs"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "import_job_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "import_type_enum"`);
  }
}
