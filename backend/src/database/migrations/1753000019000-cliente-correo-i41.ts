import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I41: los clientes tienen correo electrónico (opcional). Se carga manual
 * desde la vista de clientes o por importación de la maestra contable;
 * no es requerido para la orden de pedido.
 */
export class ClienteCorreoI411753000019000 implements MigrationInterface {
  name = 'ClienteCorreoI411753000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE clients ADD COLUMN IF NOT EXISTS email varchar(160)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE clients DROP COLUMN IF EXISTS email`);
  }
}
