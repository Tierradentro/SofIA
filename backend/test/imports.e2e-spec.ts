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
      .set('Authorization', `Bearer ${adminToken}`)
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

    // Aprobar (QA Func. 3.5: solo Administrador)
    const approve = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
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
      .set('Authorization', `Bearer ${adminToken}`)
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
      .set('Authorization', `Bearer ${adminToken}`)
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
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'CANTIDADES')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({ Referencia: 'codigo', Cantidad: 'cantidad' }))
      .attach('file', buffer, { filename: 'cantidades.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    expect(res.body.resumen.conDiferencia).toBe(2);
    expect(res.body.resumen.productosNoExistentes).toContain('NO-EXISTE');

    // Generador NO puede aprobar (M18 + QA Func. 3.5: solo Administrador → 403 RBAC)
    const porGenerador = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(porGenerador.status).toBe(403);

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
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'CLIENTES')
      .field('mapeo', JSON.stringify({ Nombre: 'nombre', Nit: 'identificacion', Ciudad: 'ciudad' }))
      .attach('file', buffer, { filename: 'clientes.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);

    await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);

    const clientes = await t.dataSource.query(`SELECT nombre FROM clients ORDER BY nombre`);
    expect(clientes.map((c: any) => c.nombre)).toEqual([
      'Repuestos del Norte',
      'Taller El Progreso',
    ]);
  });

  it('I18: cliente repetido suma dirección; cliente+dirección existentes se descarta; no sobrescribe datos', async () => {
    // Cliente previo con su dirección principal (como el alta manual)
    const [previo] = await t.dataSource.query(
      `INSERT INTO clients (id, nombre, identificacion, direccion, ciudad, telefonos)
       VALUES (gen_random_uuid(), 'Multi Dir S.A.S', '901.222.333-4', 'Cra 1 # 2-3', 'Bogotá', '3001112233')
       RETURNING id`,
    );
    await t.dataSource.query(
      `INSERT INTO client_addresses (id, client_id, direccion, ciudad, es_principal)
       VALUES (gen_random_uuid(), $1, 'Cra 1 # 2-3', 'Bogotá', true)`,
      [previo.id],
    );

    const buffer = xlsxBuffer([
      { Nombre: 'Multi Dir S.A.S', Nit: '901.222.333-4', 'Dirección': 'Cra 1 # 2-3', Ciudad: 'Bogotá', 'Teléfonos': '9999999999' },
      { Nombre: 'Multi Dir S.A.S', Nit: '901.222.333-4', 'Dirección': 'Calle 8 # 9-10', Ciudad: 'Cali', 'Teléfonos': '9999999999' },
      { Nombre: 'Nuevo Cliente Ltda', Nit: '902.333.444-5', 'Dirección': 'Av 5 # 6-7', Ciudad: 'Medellín', 'Teléfonos': '3105556677' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'CLIENTES')
      .field('mapeo', JSON.stringify({
        Nombre: 'nombre', Nit: 'identificacion', 'Dirección': 'direccion',
        Ciudad: 'ciudad', 'Teléfonos': 'telefonos',
      }))
      .attach('file', buffer, { filename: 'clientes-dir.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    // Nombre repetido ya NO invalida filas: las 3 son válidas
    expect(res.body.resumen.validas).toBe(3);
    expect(res.body.resumen.nuevos).toBe(1);
    expect(res.body.resumen.direccionesAAgregar).toBe(1);
    expect(res.body.resumen.descartados).toBe(1);

    const approve = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.body.resumen.aplicado).toMatchObject({
      nuevos: 1, direccionesAgregadas: 1, descartados: 1, omitidasMaximo: 0,
    });

    // El cliente existente conserva sus datos (no se sobrescriben)
    const [cliente] = await t.dataSource.query(
      `SELECT telefonos, direccion FROM clients WHERE id=$1`, [previo.id],
    );
    expect(cliente.telefonos).toBe('3001112233');
    expect(cliente.direccion).toBe('Cra 1 # 2-3');

    // Y ahora tiene 2 direcciones: la original (principal) + la nueva
    const dirs = await t.dataSource.query(
      `SELECT direccion, ciudad, es_principal FROM client_addresses WHERE client_id=$1 AND activo=true ORDER BY created_at`,
      [previo.id],
    );
    expect(dirs.length).toBe(2);
    expect(dirs[0]).toMatchObject({ direccion: 'Cra 1 # 2-3', es_principal: true });
    expect(dirs[1]).toMatchObject({ direccion: 'Calle 8 # 9-10', ciudad: 'Cali', es_principal: false });

    // El cliente nuevo nace con su dirección principal
    const [nuevo] = await t.dataSource.query(
      `SELECT id FROM clients WHERE identificacion='902.333.444-5'`,
    );
    const dirsNuevo = await t.dataSource.query(
      `SELECT direccion, es_principal FROM client_addresses WHERE client_id=$1`,
      [nuevo.id],
    );
    expect(dirsNuevo).toEqual([
      expect.objectContaining({ direccion: 'Av 5 # 6-7', es_principal: true }),
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

  it('QA Func. 1.1: fila con texto largo se reporta (no 500); las válidas se aplican (mejor esfuerzo)', async () => {
    const larga = 'x'.repeat(300); // descripcion es varchar(250)
    const buffer = xlsxBuffer([
      { Referencia: 'LARGA-1', Descripción: larga, Marca: 'Bosch' },
      { Referencia: 'OK-1', Descripción: 'Filtro válido', Marca: 'Brembo' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({
        Referencia: 'codigo',
        Descripción: 'descripcion',
        Marca: 'marca',
      }))
      .attach('file', buffer, { filename: 'larga.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    expect(res.body.resumen.validas).toBe(1);
    expect(res.body.resumen.invalidas.length).toBe(1);
    const err = res.body.resumen.invalidas[0].errores[0];
    expect(err).toContain('descripcion');
    expect(err).toContain('250');

    // Aprobar: mejor esfuerzo → aplica la válida, no 500
    const approve = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(201);
    expect(approve.body.resumen.aplicado.nuevos).toBe(1);

    const aplicados = await t.dataSource.query(
      `SELECT codigo FROM products WHERE empresa_id=$1 AND codigo IN ('LARGA-1','OK-1')`,
      [ireId],
    );
    expect(aplicados.map((p: any) => p.codigo)).toEqual(['OK-1']);
  });

  it('QA Func. 1.1: campos snake_case del mapeo (codigo_oe, unidad_medida) persisten en la entidad', async () => {
    const buffer = xlsxBuffer([
      { Referencia: 'OE-1', Descripción: 'Con OE', OE: 'OE-999', UM: 'UND' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({
        Referencia: 'codigo',
        Descripción: 'descripcion',
        OE: 'codigo_oe',
        UM: 'unidad_medida',
      }))
      .attach('file', buffer, { filename: 'oe.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    const approve = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(201);

    const [p] = await t.dataSource.query(
      `SELECT codigo_oe, unidad_medida FROM products WHERE empresa_id=$1 AND codigo='OE-1'`,
      [ireId],
    );
    expect(p.codigo_oe).toBe('OE-999');
    expect(p.unidad_medida).toBe('UND');
  });

  it('QA Func. 3.5: Generador ya no puede importar (403); Administrador sigue pudiendo', async () => {
    const buffer = xlsxBuffer([{ Referencia: 'X', Descripción: 'Y' }]);
    const porGenerador = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({ Referencia: 'codigo', Descripción: 'descripcion' }))
      .attach('file', buffer, { filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(porGenerador.status).toBe(403);

    const porAdmin = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'PRODUCTOS')
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({ Referencia: 'codigo', Descripción: 'descripcion' }))
      .attach('file', buffer, { filename: 'x.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(porAdmin.status).toBe(201);
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
