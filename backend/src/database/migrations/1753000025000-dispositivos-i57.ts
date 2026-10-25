import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I57: registro de dispositivos (navegadores) autorizados. La autorización
 * es por dispositivo y no por usuario; cada aprobación, rechazo y revocación
 * conserva la fecha y el usuario que la realizó.
 */
export class DispositivosI571753000025000 implements MigrationInterface {
  name = 'DispositivosI571753000025000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "device_id" varchar(64) NOT NULL,
        "nombre" varchar(160) NOT NULL,
        "user_agent" text NOT NULL,
        "idioma" varchar(40),
        "plataforma" varchar(80),
        "resolucion" varchar(20),
        "ip" varchar(60),
        "estado" varchar(12) NOT NULL DEFAULT 'PENDIENTE',
        "registrado_por_id" uuid,
        "registrado_por_nombre" varchar(160),
        "aprobado_at" timestamptz,
        "aprobado_por_id" uuid,
        "aprobado_por_nombre" varchar(160),
        "rechazado_at" timestamptz,
        "rechazado_por_id" uuid,
        "rechazado_por_nombre" varchar(160),
        "revocado_at" timestamptz,
        "revocado_por_id" uuid,
        "revocado_por_nombre" varchar(160),
        "ultimo_uso_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_devices" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_devices_device_id" UNIQUE ("device_id"),
        CONSTRAINT "devices_estado_check"
          CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO', 'REVOCADO'))
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "devices"`);
  }
}
