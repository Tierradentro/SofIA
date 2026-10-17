import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I51: exportación de pedidos a World Office (WO) — Asistente de Importación
 * de Documentos con Movimiento de Inventario.
 *
 * - orders: trazabilidad de la exportación (número de documento WO asignado,
 *   fecha, lote y marca de exportado).
 * - system_params: configuración WO por empresa (clave `wo.export.<SIGLAS>`),
 *   porque IVA, consecutivo, bodega y forma de pago difieren entre empresas.
 */
export class WorldOfficeI511753000022000 implements MigrationInterface {
  name = 'WorldOfficeI511753000022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS wo_documento_numero integer`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS exportado_wo boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS exportado_wo_at timestamptz`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS lote_exportacion uuid`,
    );

    // Configuración WO inicial por empresa existente (valores por defecto;
    // el administrador los ajusta en Administración → Parámetros).
    await queryRunner.query(
      `INSERT INTO system_params (clave, valor, descripcion)
       SELECT 'wo.export.' || c.siglas,
              jsonb_build_object(
                'empresaNombre', '',
                'tipoDocumento', 'COT',
                'prefijo', '',
                'bodegaDefault', 'Principal',
                'unidadMedida', 'Und.',
                'formaPagoDefault', 'Credito 30 DIAS',
                'vendedorDefaultNit', '',
                'diasVencimiento', 30,
                'iva', 0.19,
                'consecutivoActual', 0
              ),
              'Exportación a World Office de ' || c.nombre ||
              ' (nombre en WO, tipo doc, bodega, forma de pago, IVA y consecutivo)'
       FROM companies c
       WHERE NOT EXISTS (
         SELECT 1 FROM system_params sp
         WHERE sp.clave = 'wo.export.' || c.siglas
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM system_params WHERE clave LIKE 'wo.export.%'`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS lote_exportacion`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS exportado_wo_at`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS exportado_wo`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS wo_documento_numero`,
    );
  }
}
