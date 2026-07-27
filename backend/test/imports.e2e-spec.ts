import * as XLSX from 'xlsx';
import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

function xlsxBuffer(filas: any[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * I4 — EP-04/M18: importación contable.
 * HU-016: validación de estructura, columnas faltantes, duplicados,
 * resumen con diferencias, aprobación. M18: CANTIDADES genera movimientos
 * AJUSTE_IMPORTACION tras aprobación del Administrador, nunca sobrescritura.
 * HU-017: exportación CSV UTF-8 por empresa.
 */
describe('Importaciones contables (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    [ireId] = (
      await t.dataSource.query(`SELECT id FROM companies WHERE nombre='IRE'`)
    ).map((r: any) => r.id);
    for (const [username, rol] of [
      ['generador.i4', 'GENERADOR'],
      ['operador.i4', 'OPERADOR'],
    ] as const) {
      await t.http
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          nombre: `Usuario ${username}`,
          username,
          email: `${username}@sofia.local`,
          rol,
          claveInicial: 'ClaveInicial1',
        });
    }
    generadorToken = await loginAndSetPassword(t.http, 'generador.i4', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i4', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-010: importa productos nuevos por empresa; resumen muestra nuevos/actualizados', async () => {
    const buffer = xlsxBuffer([
      { Referencia: 'IMP-001', Descripción: 'Filtro importado uno', Marca: 'Bosch', Precio: '15000' },
      { Referencia: 'IMP-002', Descripción: 'Pastilla importada dos', Marca: 'Brembo', Precio: '45000' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({
        Referencia: 'codigo',
        Descripción: 'descripcion',
        Marca: 'marca',
        Precio: 'precio',
      }))
      .attach('file', buffer, { filename: 'maestra.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('PENDIENTE_APROBACION');
    expect(res.body.resumen.nuevos).toBe(2);
    expect(res.body.resumen.actualizados).toBe(0);

    // Aprobar (Generador puede aprobar productos)
    const approve = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(approve.status).toBe(201);
    expect(approve.body.resumen.aplicado.nuevos).toBe(2);

    const productos = await t.dataSource.query(
      `SELECT codigo, marca, precio FROM products WHERE empresa_id=$1 ORDER BY codigo`,
      [ireId],
    );
    expect(productos.length).toBe(2);
    expect(productos[0].marca).toBe('Bosch');
  });

  it('HU-016: columnas faltantes sin mapear → 400 con detalle de faltantes', async () => {
    const buffer = xlsxBuffer([{ Referencia: 'X-1' }]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({ Referencia: 'codigo' })) // falta descripcion
      .attach('file', buffer, { filename: 'incompleta.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COLUMNAS_FALTANTES');
    expect(res.body.columnasFaltantes).toContain('descripcion');
  });

  it('HU-016: duplicados en el archivo quedan reportados en el resumen', async () => {
    const buffer = xlsxBuffer([
      { Referencia: 'DUP-1', Descripción: 'Uno' },
      { Referencia: 'DUP-1', Descripción: 'Duplicado' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({ Referencia: 'codigo', Descripción: 'descripcion' }))
      .attach('file', buffer, { filename: 'dup.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    expect(res.body.resumen.duplicados).toContain('DUP-1');
    expect(res.body.resumen.invalidas.length).toBe(1);
    expect(res.body.resumen.validas).toBe(1);
  });

  it('M18: CANTIDADES requiere aprobación del Administrador y ajusta por movimientos, no sobrescritura', async () => {
    // Archivo con cantidades nuevas para IMP-001 (hoy 0) y un código inexistente
    const buffer = xlsxBuffer([
      { Referencia: 'IMP-001', Cantidad: '25' },
      { Referencia: 'IMP-002', Cantidad: '10' },
      { Referencia: 'NO-EXISTE', Cantidad: '7' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipo', 'CANTIDADES')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({ Referencia: 'codigo', Cantidad: 'cantidad' }))
      .attach('file', buffer, { filename: 'cantidades.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    expect(res.body.resumen.conDiferencia).toBe(2);
    expect(res.body.resumen.productosNoExistentes).toContain('NO-EXISTE');

    // Generador NO puede aprobar cantidades (M18: Administrador)
    const porGenerador = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(porGenerador.status).toBe(400);

    // Administrador aprueba → movimientos AJUSTE_IMPORTACION en una transacción
    const porAdmin = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(porAdmin.status).toBe(201);
    expect(porAdmin.body.resumen.aplicado.ajustes).toBe(2);

    // Saldos actualizados por movimientos (no por UPDATE directo)
    const [p] = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE codigo='IMP-001' AND empresa_id=$1`,
      [ireId],
    );
    expect(p.cantidad).toBe(25);

    const movimientos = await t.dataSource.query(
      `SELECT m.tipo, m.cantidad_delta, m.doc_tipo, m.doc_id
       FROM inventory_movements m JOIN products p ON p.id=m.product_id
       WHERE p.codigo='IMP-001' AND p.empresa_id=$1`,
      [ireId],
    );
    expect(movimientos.length).toBe(1);
    expect(movimientos[0].tipo).toBe('AJUSTE_IMPORTACION');
    expect(movimientos[0].cantidad_delta).toBe(25);
    expect(movimientos[0].doc_tipo).toBe('IMPORTACION');

    // Reconciliación: suma(movimientos) = saldo
    const [prod] = await t.dataSource.query(
      `SELECT id FROM products WHERE codigo='IMP-001' AND empresa_id=$1`,
      [ireId],
    );
    const reconcile = await t.http
      .get(`/api/v1/movements/producto/${prod.id}/reconcile`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reconcile.body.consistente).toBe(true);
  });

  it('HU-010: importa clientes desde la maestra contable (catálogo global)', async () => {
    const buffer = xlsxBuffer([
      { Nombre: 'Taller El Progreso', Nit: '800.111.222-3', Ciudad: 'Cali' },
      { Nombre: 'Repuestos del Norte', Nit: '900.333.444-5', Ciudad: 'Barranquilla' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipo', 'CLIENTES')
      .field('mapeo', JSON.stringify({ Nombre: 'nombre', Nit: 'identificacion', Ciudad: 'ciudad' }))
      .attach('file', buffer, { filename: 'clientes.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);

    await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`);

    const clientes = await t.dataSource.query(`SELECT nombre FROM clients ORDER BY nombre`);
    expect(clientes.map((c: any) => c.nombre)).toEqual([
      'Repuestos del Norte',
      'Taller El Progreso',
    ]);
  });

  it('HU-017: exportación CSV UTF-8 por empresa con trazabilidad (empresa en cada fila)', async () => {
    const res = await t.http
      .get(`/api/v1/exports/products.csv?empresaId=${ireId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff); // BOM UTF-8
    const lineas = res.text.split('\n');
    expect(lineas[0]).toContain('empresa,codigo,descripcion');
    expect(lineas[1]).toContain('IRE,IMP-001');
    // Cada fila lleva la empresa (trazabilidad)
    for (const linea of lineas.slice(1)) {
      if (linea) expect(linea.startsWith('IRE,')).toBe(true);
    }

    // Auditado
    const logs = await t.dataSource.query(
      `SELECT valor_nuevo FROM audit_logs WHERE accion='EXPORTACION_CSV'`,
    );
    expect(logs.length).toBe(1);
    expect(logs[0].valor_nuevo.registros).toBe(2);
  });

  it('RBAC negativo: Operador recibe 403 al importar y exportar', async () => {
    const buffer = xlsxBuffer([{ Referencia: 'X', Descripción: 'Y' }]);
    const imp = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${operadorToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({ Referencia: 'codigo', Descripción: 'descripcion' }))
      .attach('file', buffer, { filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(imp.status).toBe(403);

    const exp = await t.http
      .get(`/api/v1/exports/products.csv?empresaId=${ireId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(exp.status).toBe(403);
  });
});
