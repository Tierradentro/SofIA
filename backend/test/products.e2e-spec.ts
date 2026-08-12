import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I3 — HU-009 Crear producto, HU-011/012 Código de barras, HU-013 Consulta.
 * Reglas: unicidad global de barcode con aviso del producto dueño (M05),
 * aislamiento multiempresa en backend, búsqueda pg_trgm, CHECK cantidades,
 * RBAC (Operador no crea productos → 403).
 */
describe('Productos (e2e)', () => {
  let t: TestApp;
  let generadorToken: string;
  let operadorToken: string;
  let adminToken: string;
  let ireId: string;
  let icvId: string;

  async function crearUsuario(username: string, rol: string) {
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
    return loginAndSetPassword(t.http, username, 'ClaveInicial1', 'ClaveNueva123');
  }

  async function crearProducto(empresaId: string, codigo: string, descripcion: string) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId,
        codigo,
        descripcion,
        marca: 'Generica',
        unidadMedida: 'UND',
        precio: 10000,
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    const companies = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = companies.find((c: any) => c.nombre === 'IRE').id;
    icvId = companies.find((c: any) => c.nombre === 'ICV').id;
    generadorToken = await crearUsuario('generador.i3', 'GENERADOR');
    operadorToken = await crearUsuario('operador.i3', 'OPERADOR');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-009: Generador crea producto por empresa; cantidades nacen en 0 y queda auditado', async () => {
    const p = await crearProducto(ireId, 'IRE-REF-001', 'Filtro de aceite motor 1.6');
    expect(p.cantidad).toBe(0);
    expect(p.cantidadBloqueada).toBe(0);
    expect(p.estado).toBe('ACTIVO');

    const logs = await t.dataSource.query(
      `SELECT accion, tabla FROM audit_logs WHERE tabla='Productos' AND registro_id=$1 AND accion='CREAR'`,
      [p.id],
    );
    expect(logs.length).toBe(1);
  });

  it('HU-009: código duplicado en la MISMA empresa → 409; en OTRA empresa → permitido', async () => {
    const dup = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, codigo: 'IRE-REF-001', descripcion: 'Duplicado' });
    expect(dup.status).toBe(409);

    // El mismo código en ICV es un producto distinto (existencias nunca se mezclan)
    const p = await crearProducto(icvId, 'IRE-REF-001', 'Filtro de aceite motor 1.6 (ICV)');
    expect(p.empresaId).toBe(icvId);
  });

  it('RBAC negativo: Operador recibe 403 al crear producto (matriz §4)', async () => {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ empresaId: ireId, codigo: 'X-001', descripcion: 'No permitido' });
    expect(res.status).toBe(403);
  });

  it('HU-011/012: Operador asocia código escaneado y Generador uno manual; origen registrado', async () => {
    const p1 = await crearProducto(ireId, 'IRE-REF-002', 'Pastillas de freno delanteras');
    const r1 = await t.http
      .post(`/api/v1/products/${p1.id}/barcode`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ barcode: '7701234567890', origen: 'ESCANEADO' });
    expect(r1.status).toBe(201);
    expect(r1.body.codigoBarras.origen).toBe('ESCANEADO');

    const p2 = await crearProducto(ireId, 'IRE-REF-003', 'Bujía iridio larga');
    const r2 = await t.http
      .post(`/api/v1/products/${p2.id}/barcode`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ barcode: 'MAN-0001', origen: 'MANUAL' });
    expect(r2.status).toBe(201);
    expect(r2.body.codigoBarras.origen).toBe('MANUAL');
  });

  it('M05: barcode duplicado en cualquier empresa → 409 e informa el producto dueño', async () => {
    const otro = await crearProducto(icvId, 'ICV-REF-001', 'Amortiguador trasero');
    const res = await t.http
      .post(`/api/v1/products/${otro.id}/barcode`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ barcode: '7701234567890', origen: 'ESCANEADO' }); // ya es de IRE-REF-002
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('BARCODE_DUPLICADO');
    expect(res.body.productoDueno.codigo).toBe('IRE-REF-002');
    expect(res.body.productoDueno.empresa).toBe('IRE');
  });

  it('M05: un producto tiene un único código de barras → segundo intento 409', async () => {
    const productos = await t.dataSource.query(
      `SELECT id FROM products WHERE codigo='IRE-REF-002'`,
    );
    const res = await t.http
      .post(`/api/v1/products/${productos[0].id}/barcode`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ barcode: 'OTRO-CODIGO-99', origen: 'ESCANEADO' });
    expect(res.status).toBe(409);
  });

  it('HU-013: consulta por barcode, código, OE y referencia cruzada con empresa e inventario', async () => {
    const p = await crearProducto(ireId, 'IRE-REF-004', 'Correa de distribución kit');
    await t.http
      .patch(`/api/v1/products/${p.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ codigoOE: 'OE-999', refCruzada1: 'REF-CRUZ-A', ubicacion: 'A-01-2' });
    await t.http
      .post(`/api/v1/products/${p.id}/barcode`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ barcode: '7709998887776', origen: 'ESCANEADO' });

    for (const criterio of ['7709998887776', 'IRE-REF-004', 'OE-999', 'REF-CRUZ-A']) {
      const res = await t.http
        .get(`/api/v1/products/lookup/${criterio}?empresaId=${ireId}`)
        .set('Authorization', `Bearer ${operadorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.empresa.nombre).toBe('IRE');
      expect(res.body.codigoBarras.barcode).toBe('7709998887776');
      expect(res.body.ubicacion).toBe('A-01-2');
      expect(res.body.inventario.disponible).toBe(0);
    }
  });

  it('Búsqueda por descripción (pg_trgm) filtrada por empresa desde el backend', async () => {
    const res = await t.http
      .get('/api/v1/products/search?q=filtro%20aceite&empresaId=' + ireId)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    // Solo productos de IRE (el de ICV con descripción similar no aparece)
    for (const p of res.body) {
      expect(p.empresa.nombre).toBe('IRE');
    }
    // Sin filtro, se visualizan juntas (regla: se visualizan juntas en dashboard)
    const todas = await t.http
      .get('/api/v1/products/search?q=filtro%20aceite')
      .set('Authorization', `Bearer ${operadorToken}`);
    const empresas = new Set(todas.body.map((p: any) => p.empresa.nombre));
    expect(empresas.size).toBe(2);
  });

  it('QA Func. 2.3: PUT barcode reemplaza transaccionalmente, libera el anterior y audita', async () => {
    const p = await crearProducto(ireId, 'IRE-REF-005', 'Kit de embrague');
    await t.http
      .post(`/api/v1/products/${p.id}/barcode`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ barcode: '770MAL000001', origen: 'MANUAL' });

    // Reemplazo por el Generador
    const res = await t.http
      .put(`/api/v1/products/${p.id}/barcode`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ barcode: '770BIEN00002', origen: 'MANUAL' });
    expect(res.status).toBe(200);
    expect(res.body.codigoBarras.barcode).toBe('770BIEN00002');

    // El código anterior quedó libre: se puede asociar a otro producto
    const otro = await crearProducto(ireId, 'IRE-REF-006', 'Rodamiento delantero');
    const reasignar = await t.http
      .post(`/api/v1/products/${otro.id}/barcode`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ barcode: '770MAL000001', origen: 'ESCANEADO' });
    expect(reasignar.status).toBe(201);

    // Auditoría con valor anterior y nuevo
    const logs = await t.dataSource.query(
      `SELECT valor_anterior, valor_nuevo FROM audit_logs WHERE accion='CORREGIR_BARCODE' AND registro_id=$1`,
      [p.id],
    );
    expect(logs.length).toBe(1);
    expect(logs[0].valor_anterior.barcode).toBe('770MAL000001');
    expect(logs[0].valor_nuevo.barcode).toBe('770BIEN00002');

    // RBAC negativo: Operador no puede corregir
    const prohibido = await t.http
      .put(`/api/v1/products/${p.id}/barcode`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ barcode: 'OTRO', origen: 'MANUAL' });
    expect(prohibido.status).toBe(403);
  });

  it('QA Func. 2.4: búsqueda parcial por código, OE y referencia cruzada', async () => {
    const p = await crearProducto(ireId, 'IRE-REF-007', 'Bomba de agua');
    await t.http
      .patch(`/api/v1/products/${p.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ codigoOE: 'OE-ABC-777', refCruzada1: 'GATES-999' });

    // Subcadena en medio del código (antes no aparecía con match exacto)
    const porCodigo = await t.http
      .get('/api/v1/products/search?q=REF-007&empresaId=' + ireId)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porCodigo.body.some((x: any) => x.codigo === 'IRE-REF-007')).toBe(true);

    const porOe = await t.http
      .get('/api/v1/products/search?q=ABC-777&empresaId=' + ireId)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porOe.body.some((x: any) => x.id === p.id)).toBe(true);

    const porRef = await t.http
      .get('/api/v1/products/search?q=GATES-999&empresaId=' + ireId)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porRef.body.some((x: any) => x.id === p.id)).toBe(true);

    // La búsqueda por descripción sigue funcionando como antes
    const porDesc = await t.http
      .get('/api/v1/products/search?q=bomba%20agua&empresaId=' + ireId)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porDesc.body.some((x: any) => x.id === p.id)).toBe(true);
  });

  it('QA Func. 2.2: GET /products/:id devuelve la ficha completa y PATCH actualiza campos del catálogo', async () => {
    const p = await crearProducto(ireId, 'IRE-REF-008', 'Termostato');
    const res = await t.http
      .patch(`/api/v1/products/${p.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        categoria: 'Refrigeración',
        subcategoria: 'Termostatos',
        aplicacion: 'Motor 2.0',
        linkImagen: 'https://ejemplo.com/termostato.png',
        grupoSiete: 'G7-01',
      });
    expect(res.status).toBe(200);

    const ficha = await t.http
      .get(`/api/v1/products/${p.id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(ficha.status).toBe(200);
    expect(ficha.body.categoria).toBe('Refrigeración');
    expect(ficha.body.linkImagen).toBe('https://ejemplo.com/termostato.png');
    expect(ficha.body.grupoSiete).toBe('G7-01');
    expect(ficha.body.empresa.nombre).toBe('IRE');

    // La empresa no se puede cambiar por PATCH
    const cambioEmpresa = await t.http
      .patch(`/api/v1/products/${p.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: icvId });
    expect(cambioEmpresa.status).toBe(400);
  });

  it('Aislamiento multiempresa: listado por empresa nunca mezcla productos', async () => {
    const ire = await t.http
      .get(`/api/v1/products?empresaId=${ireId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const icv = await t.http
      .get(`/api/v1/products?empresaId=${icvId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(ire.status).toBe(200);
    expect(icv.status).toBe(200);
    expect(ire.body.every((p: any) => p.empresaId === ireId)).toBe(true);
    expect(icv.body.every((p: any) => p.empresaId === icvId)).toBe(true);
  });

  it('CHECK de BD: cantidad_bloqueada no puede superar cantidad (invariante en BD)', async () => {
    await expect(
      t.dataSource.query(
        `UPDATE products SET cantidad_bloqueada = 5 WHERE cantidad = 0`,
      ),
    ).rejects.toThrow();
  });
});
