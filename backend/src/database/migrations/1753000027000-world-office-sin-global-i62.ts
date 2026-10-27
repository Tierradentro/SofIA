import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I62 (ajuste): la configuración de exportación a World Office queda
 * EXCLUSIVAMENTE por empresa (`wo.export.<SIGLAS>`). La clave global
 * histórica `wo.export` (I52) se elimina: la migración 1753000026000 ya
 * copió su valor a cada empresa, así que ninguna configuración se pierde.
 */
export class WorldOfficeSinGlobalI621753000027000 implements MigrationInterface {
  name = 'WorldOfficeSinGlobalI621753000027000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM system_params WHERE clave = 'wo.export'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No se restaura la clave global: la configuración vive por empresa.
  }
}
