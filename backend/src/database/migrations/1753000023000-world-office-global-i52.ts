import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I52: reestructura de los parámetros de World Office.
 * I51 creó `wo.export.<SIGLAS>` por empresa; la configuración real es GLOBAL
 * (tipo doc, bodega, unidad, forma de pago, vencimiento e IVA aplican a
 * todas las empresas) y solo el consecutivo es por empresa:
 * - `wo.export` (global) — se construye desde la config I51 existente.
 * - `wo.consecutivo.<SIGLAS>` (por empresa) — conserva el consecutivoActual.
 * Empresa emisora, NIT del vendedor y nota salen de la base (companies,
 * comerciales, orders), no de parámetros.
 */
export class WorldOfficeGlobalI521753000023000 implements MigrationInterface {
  name = 'WorldOfficeGlobalI521753000023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Parámetro global a partir de la primera config I51 (si existe)
    await queryRunner.query(
      `INSERT INTO system_params (clave, valor, descripcion)
       SELECT 'wo.export',
              jsonb_build_object(
                'tipoDocumento', COALESCE(t.valor->>'tipoDocumento', 'COT'),
                'prefijo', COALESCE(t.valor->>'prefijo', ''),
                'bodegaDefault', COALESCE(t.valor->>'bodegaDefault', 'Principal'),
                'unidadMedida', COALESCE(t.valor->>'unidadMedida', 'Und.'),
                'formaPagoDefault', COALESCE(t.valor->>'formaPagoDefault', 'Credito 30 DIAS'),
                'diasVencimiento', COALESCE((t.valor->>'diasVencimiento')::int, 30),
                'iva', COALESCE((t.valor->>'iva')::numeric, 0.19)
              ),
              'Exportación a World Office: tipo doc, bodega, unidad, forma de pago, vencimiento e IVA (común a todas las empresas)'
       FROM (
         SELECT valor FROM system_params
         WHERE clave LIKE 'wo.export.%' ORDER BY clave LIMIT 1
       ) t
       WHERE NOT EXISTS (SELECT 1 FROM system_params WHERE clave = 'wo.export')`,
    );
    // 2) Si no había config I51, sembrar la global con valores por defecto
    await queryRunner.query(
      `INSERT INTO system_params (clave, valor, descripcion)
       SELECT 'wo.export',
              '{"tipoDocumento":"COT","prefijo":"","bodegaDefault":"Principal","unidadMedida":"Und.","formaPagoDefault":"Credito 30 DIAS","diasVencimiento":30,"iva":0.19}'::jsonb,
              'Exportación a World Office: tipo doc, bodega, unidad, forma de pago, vencimiento e IVA (común a todas las empresas)'
       WHERE NOT EXISTS (SELECT 1 FROM system_params WHERE clave = 'wo.export')`,
    );
    // 3) Consecutivo por empresa, conservando el valor I51 si existía
    await queryRunner.query(
      `INSERT INTO system_params (clave, valor, descripcion)
       SELECT 'wo.consecutivo.' || c.siglas,
              jsonb_build_object(
                'consecutivoActual',
                COALESCE((
                  SELECT (sp.valor->>'consecutivoActual')::int
                  FROM system_params sp
                  WHERE sp.clave = 'wo.export.' || c.siglas
                ), 0)
              ),
              'Consecutivo del documento World Office de ' || c.nombre || ' (último número usado; el próximo es +1)'
       FROM companies c
       WHERE NOT EXISTS (
         SELECT 1 FROM system_params sp2
         WHERE sp2.clave = 'wo.consecutivo.' || c.siglas
       )`,
    );
    // 4) Retirar las claves I51 por empresa
    await queryRunner.query(
      `DELETE FROM system_params WHERE clave LIKE 'wo.export.%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reconstruir las claves I51 (config por empresa) fusionando global + consecutivo
    await queryRunner.query(
      `INSERT INTO system_params (clave, valor, descripcion)
       SELECT 'wo.export.' || c.siglas,
              COALESCE(g.valor, '{}'::jsonb) ||
              jsonb_build_object(
                'empresaNombre', '',
                'vendedorDefaultNit', '',
                'consecutivoActual',
                COALESCE((s.valor->>'consecutivoActual')::int, 0)
              ),
              'Exportación a World Office de ' || c.nombre
       FROM companies c
       LEFT JOIN system_params g ON g.clave = 'wo.export'
       LEFT JOIN system_params s ON s.clave = 'wo.consecutivo.' || c.siglas
       WHERE NOT EXISTS (
         SELECT 1 FROM system_params sp WHERE sp.clave = 'wo.export.' || c.siglas
       )`,
    );
    await queryRunner.query(
      `DELETE FROM system_params WHERE clave = 'wo.export' OR clave LIKE 'wo.consecutivo.%'`,
    );
  }
}
