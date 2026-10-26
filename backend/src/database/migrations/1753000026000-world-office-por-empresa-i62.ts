import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I62: los parámetros de exportación a World Office se separan POR EMPRESA.
 * I52 los había unificado en la clave global `wo.export`; ahora cada empresa
 * tiene su propia configuración en `wo.export.<SIGLAS>` (tipo de documento,
 * prefijo, bodega, unidad de medida, forma de pago, días de vencimiento e
 * IVA), sembrada desde la config global vigente o con los valores por
 * defecto. La clave global se conserva como respaldo mientras exista
 * (resolverConfigWo la usa solo si la empresa no tiene la suya).
 */
export class WorldOfficePorEmpresaI621753000026000 implements MigrationInterface {
  name = 'WorldOfficePorEmpresaI621753000026000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO system_params (clave, valor, descripcion)
       SELECT 'wo.export.' || c.siglas,
              COALESCE(g.valor, jsonb_build_object(
                'tipoDocumento', 'COT',
                'prefijo', '',
                'bodegaDefault', 'Principal',
                'unidadMedida', 'Und.',
                'formaPagoDefault', 'Credito 30 DIAS',
                'diasVencimiento', 30,
                'iva', 0.19
              )),
              'Exportación a World Office de ' || c.nombre || ': tipo doc, prefijo, bodega, unidad, forma de pago, vencimiento e IVA (por empresa)'
       FROM companies c
       LEFT JOIN system_params g ON g.clave = 'wo.export'
       WHERE NOT EXISTS (
         SELECT 1 FROM system_params sp WHERE sp.clave = 'wo.export.' || c.siglas
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM system_params WHERE clave LIKE 'wo.export.%'`,
    );
  }
}
