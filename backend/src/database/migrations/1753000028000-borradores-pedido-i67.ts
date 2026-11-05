import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I67: borradores de pedido. Guardan el formulario de «Nuevo pedido» de
 * forma automática mientras el operario digita, para que una desconexión o
 * un corte de energía no pierda el trabajo. No consumen consecutivo ni
 * bloquean existencias: el número del pedido se asigna al confirmar.
 */
export class BorradoresPedidoI671753000028000 implements MigrationInterface {
  name = 'BorradoresPedidoI671753000028000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_drafts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "empresa_id" uuid,
        "payload" jsonb NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_drafts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_drafts_user" ON "order_drafts" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_drafts"`);
  }
}
