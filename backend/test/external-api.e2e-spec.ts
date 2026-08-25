import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I11 — EP-12: API externa.
 * HU-060 (crear pedido por API), HU-061 (consultar productos), HU-062
 * (consultar despacho), HU-063 (registrar guía). Autenticación por header
 * X-API-Key (M17: hash en BD, clave visible una sola vez, asociada a
 * usuario rol API), rate limit por key (429), y RBAC: los endpoints
 * externos solo aceptan rol API.
 */
describe('API externa (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let clienteId: string;
  let comercialId: string;
  let carrierId: string;
  let apiKey: string;

  async function crearProducto(codigo: string, cantidad: number, barcode?: string) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, codigo, descripcion: `Producto ${codigo}`, unidadMedida: 'UND', precio: 12000 });
    expect(res.status).toBe(201);
    const producto = res.body;
    if (cantidad > 0) {
      await t.dataSource.query(`UPDATE products SET cantidad=$1 WHERE id=$2`, [cantidad, producto.id]);
    }
    if (barcode) {
      await t.http
        .post(`/api/v1/products/${producto.id}/barcode`)
        .set('Authorization', `Bearer ${generadorToken}`)
        .send({ barcode, origen: 'MANUAL' });
    }
    return producto;
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);
    // I29: la suite supera el límite por defecto (20/min) con los nuevos
    // endpoints de catálogo; se sube a 500/min para no disparar 429 entre tests
    await t.http
      .put('/api/v1/admin/params/api.rate_limit_per_minute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: { requests_per_minute: 500 }, motivo: 'Suite e2e I29' });
    const empresas = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente API Externa', identificacion: '900999111', ciudad: 'Bogotá', direccion: 'Av 68 # 10-20' });
    clienteId = cli.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial API', identificacion: 'C-X11' });
    comercialId = com.body.id;
    const car = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Transportadora API', tipo: 'EXTERNA', identificacion: '890333' });
    carrierId = car.body.id;

    for (const [username, rol] of [
      ['generador.i11', 'GENERADOR'],
      ['operador.i11', 'OPERADOR'],
      ['integracion.i11', 'API'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i11', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i11', 'ClaveInicial1', 'ClaveNueva123');

    // API key para el usuario de integración (M17: clave visible una vez)
    const apiUser = await t.dataSource.query(`SELECT id FROM users WHERE username='integracion.i11'`);
    const key = await t.http
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: apiUser[0].id, nombre: 'ERP corporativo' });
    expect(key.status).toBe(201);
    expect(key.body.clave).toMatch(/^sk_/);
    apiKey = key.body.clave;
    (global as any).__keyId = key.body.id;

    await crearProducto('EXT-001', 15, '7511001');
    await crearProducto('EXT-002', 3);
    await crearProducto('EXT-003', 0);
  });

  afterAll(async () => {
    delete process.env.EXTERNAL_API_RATE_LIMIT;
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('Autenticación: sin key / key inválida / JWT de otro rol son rechazados', async () => {
    // Sin credenciales
    const sinKey = await t.http.get(`/api/v1/api/products?empresaId=${ireId}`);
    expect(sinKey.status).toBe(401);

    // Key inventada
    const mala = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}`)
      .set('X-API-Key', 'sk_deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    expect(mala.status).toBe(401);

    // JWT de un usuario interno (Generador) no entra a la API externa
    const jwtInterno = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(jwtInterno.status).toBe(403);

    // Con la key correcta sí
    const ok = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}`)
      .set('X-API-Key', apiKey);
    expect(ok.status).toBe(200);
  });

  it('HU-061: productos por empresa, código y disponibilidad', async () => {
    const todos = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}`)
      .set('X-API-Key', apiKey);
    expect(todos.status).toBe(200);
    expect(todos.body).toHaveLength(3);
    const p1 = todos.body.find((p: any) => p.codigo === 'EXT-001');
    expect(p1.cantidad).toBe(15);
    expect(p1.disponible).toBe(15);
    expect(p1.empresa).toBe('IRE');

    // Filtro por código (y por referencia alterna)
    const porCodigo = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}&codigo=EXT-002`)
      .set('X-API-Key', apiKey);
    expect(porCodigo.body).toHaveLength(1);
    expect(porCodigo.body[0].codigo).toBe('EXT-002');

    // Solo disponibles (EXT-003 tiene 0)
    const disp = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}&disponibles=true`)
      .set('X-API-Key', apiKey);
    expect(disp.body.map((p: any) => p.codigo).sort()).toEqual(['EXT-001', 'EXT-002']);

    // empresaId requerido
    const sinEmpresa = await t.http.get('/api/v1/api/products').set('X-API-Key', apiKey);
    expect(sinEmpresa.status).toBe(400);
  });

  it('I29: catálogos para integración autónoma — clients, comerciales, companies, búsqueda de productos', async () => {
    // Empresas activas (el agente descubre los empresaId válidos)
    const empresas = await t.http.get('/api/v1/api/companies').set('X-API-Key', apiKey);
    expect(empresas.status).toBe(200);
    expect(empresas.body.some((e: any) => e.id === ireId)).toBe(true);

    // Clientes por nombre o identificación (resuelve el UUID del pedido)
    const clientes = await t.http.get('/api/v1/api/clients?q=API%20Externa').set('X-API-Key', apiKey);
    expect(clientes.status).toBe(200);
    expect(clientes.body.some((c: any) => c.id === clienteId)).toBe(true);

    // Comerciales por nombre o identificación
    const comerciales = await t.http.get('/api/v1/api/comerciales').set('X-API-Key', apiKey);
    expect(comerciales.status).toBe(200);
    expect(comerciales.body.some((c: any) => c.id === comercialId)).toBe(true);

    // Búsqueda parcial de productos por texto (sin código exacto)
    const busqueda = await t.http
      .get(`/api/v1/api/products/search?q=EXT-001&empresaId=${ireId}`)
      .set('X-API-Key', apiKey);
    expect(busqueda.status).toBe(200);
    expect(busqueda.body.some((p: any) => p.codigo === 'EXT-001')).toBe(true);
    const sinQ = await t.http.get(`/api/v1/api/products/search?empresaId=${ireId}`).set('X-API-Key', apiKey);
    expect(sinQ.status).toBe(400);
  });

  it('I31: listados limitados, q con tope de longitud y búsqueda solo por empresa', async () => {
    // Búsqueda de productos exige empresaId (no mezcla catálogos de empresas)
    const sinEmpresa = await t.http
      .get('/api/v1/api/products/search?q=EXT')
      .set('X-API-Key', apiKey);
    expect(sinEmpresa.status).toBe(400);
    expect(sinEmpresa.body.message).toContain('empresaId');
    const empresaInexistente = await t.http
      .get('/api/v1/api/products/search?q=EXT&empresaId=00000000-0000-4000-8000-000000000000')
      .set('X-API-Key', apiKey);
    expect(empresaInexistente.status).toBe(400);

    // q demasiado largo → 400 en las tres búsquedas
    const qLargo = 'x'.repeat(101);
    const prodQLargo = await t.http
      .get(`/api/v1/api/products/search?q=${qLargo}&empresaId=${ireId}`)
      .set('X-API-Key', apiKey);
    expect(prodQLargo.status).toBe(400);
    expect(prodQLargo.body.message).toContain('100');
    const cliQLargo = await t.http
      .get(`/api/v1/api/clients?q=${qLargo}`)
      .set('X-API-Key', apiKey);
    expect(cliQLargo.status).toBe(400);
    const comQLargo = await t.http
      .get(`/api/v1/api/comerciales?q=${qLargo}`)
      .set('X-API-Key', apiKey);
    expect(comQLargo.status).toBe(400);

    // Los listados tienen página limitada (máx. 200)
    const clientes = await t.http.get('/api/v1/api/clients').set('X-API-Key', apiKey);
    expect(clientes.status).toBe(200);
    expect(Array.isArray(clientes.body)).toBe(true);
    expect(clientes.body.length).toBeLessThanOrEqual(200);
    const comerciales = await t.http.get('/api/v1/api/comerciales?limite=9999').set('X-API-Key', apiKey);
    expect(comerciales.status).toBe(200);
    expect(comerciales.body.length).toBeLessThanOrEqual(200);
  });

  it('I29: UUIDs inexistentes en crear pedido responden 404 con el recurso exacto', async () => {
    const inexistente = '00000000-0000-4000-8000-000000000000';
    const sinCliente = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', apiKey)
      .send({ empresaId: ireId, clienteId: inexistente, comercialId, items: [{ referencia: 'EXT-001', cantidad: 1 }] });
    expect(sinCliente.status).toBe(404);
    expect(sinCliente.body.message).toContain('Cliente no encontrado');

    const sinComercial = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', apiKey)
      .send({ empresaId: ireId, clienteId, comercialId: inexistente, items: [{ referencia: 'EXT-001', cantidad: 1 }] });
    expect(sinComercial.status).toBe(404);
    expect(sinComercial.body.message).toContain('Comercial no encontrado');

    const sinEmpresa = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', apiKey)
      .send({ empresaId: inexistente, clienteId, comercialId, items: [{ referencia: 'EXT-001', cantidad: 1 }] });
    expect(sinEmpresa.status).toBe(404);
    expect(sinEmpresa.body.message).toContain('Empresa no encontrada');
  });

  it('I14 (M-7): la API key no puede navegar los endpoints internos /orders (403)', async () => {
    // La API key es válida (pasa autenticación) pero el rol API no está en
    // el RBAC de los listados/detalle internos del WMS
    const lista = await t.http.get('/api/v1/orders').set('X-API-Key', apiKey);
    expect(lista.status).toBe(403);
    const detalle = await t.http
      .get('/api/v1/orders/00000000-0000-4000-8000-000000000000')
      .set('X-API-Key', apiKey);
    expect(detalle.status).toBe(403);
    // Los roles internos sí acceden
    const interno = await t.http
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(interno.status).toBe(200);
  });

  it('HU-060: crear pedido validando empresa, cliente, productos y cantidades', async () => {
    // Cliente inexistente → 4xx
    const clienteMalo = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', apiKey)
      .send({
        empresaId: ireId,
        clienteId: '00000000-0000-4000-8000-000000000000',
        items: [{ referencia: 'EXT-001', cantidad: 1 }],
      });
    expect([400, 404]).toContain(clienteMalo.status);

    // Producto inexistente → 400
    const productoMalo = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', apiKey)
      .send({ empresaId: ireId, clienteId, items: [{ referencia: 'NOEXISTE', cantidad: 1 }] });
    expect(productoMalo.status).toBe(400);

    // Cantidad sin disponibilidad → 400 (validación M08)
    const sinDisponibilidad = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', apiKey)
      .send({ empresaId: ireId, clienteId, items: [{ referencia: 'EXT-002', cantidad: 99 }] });
    expect(sinDisponibilidad.status).toBe(400);

    const res = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', apiKey)
      .send({
        empresaId: ireId,
        clienteId,
        comercialId,
        ciudad: 'Bogotá',
        ordenPedido: 'OC-ERP-4451',
        items: [
          { referencia: 'EXT-001', cantidad: 4 },
          { referencia: 'EXT-002', cantidad: 2 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.numero).toMatch(/^IRE-\d{4}$/);
    expect(res.body.estado).toBe('ABIERTO');
    (global as any).__pedidoApi = res.body;

    // El pedido quedó auditado con el usuario de integración
    const log = await t.dataSource.query(
      `SELECT usuario_username FROM audit_logs WHERE tabla='Pedidos' AND registro_id=$1`,
      [res.body.id],
    );
    expect(log[0].usuario_username).toBe('integracion.i11');
  });

  it('HU-062/063: consultar despacho y registrar guía por API', async () => {
    const pedido = (global as any).__pedidoApi;

    // Alistar por API interna y aprobar (flujo Operador/Generador)
    for (const [codigo, cantidad] of [['7511001', 4], ['EXT-002', 2]] as const) {
      const scan = await t.http
        .post(`/api/v1/orders/${pedido.id}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ modo: 'COMPLETO', codigo, cantidad });
      expect(scan.status).toBe(201);
    }
    await t.http.post(`/api/v1/orders/${pedido.id}/finalizar-picking`).set('Authorization', `Bearer ${operadorToken}`);
    await t.dataSource.query(`UPDATE orders SET estado='APROBADO', aprobado_at=now() WHERE id=$1`, [pedido.id]);

    // Despacho con una caja cerrada
    const d = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedido.id });
    const dId = d.body.id;
    await t.http.post(`/api/v1/dispatches/${dId}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);
    const box = await t.http.post(`/api/v1/dispatches/${dId}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http.post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/scan`).set('Authorization', `Bearer ${operadorToken}`).send({ codigo: '7511001', cantidad: 4 });
    await t.http.post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/scan`).set('Authorization', `Bearer ${operadorToken}`).send({ codigo: 'EXT-002', cantidad: 2 });
    await t.http.post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/cerrar`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http.post(`/api/v1/dispatches/${dId}/finalizar-empaque`).set('Authorization', `Bearer ${operadorToken}`);

    // HU-062: consulta del despacho por número
    const consulta = await t.http
      .get(`/api/v1/api/dispatch/${d.body.numero}`)
      .set('X-API-Key', apiKey);
    expect(consulta.status).toBe(200);
    expect(consulta.body.numero).toBe(d.body.numero);
    expect(consulta.body.estado).toBe('ABIERTO');
    expect(consulta.body.cliente.nombre).toBe('Cliente API Externa');
    expect(consulta.body.cajas).toHaveLength(1);
    expect(consulta.body.cajas[0].items).toHaveLength(2);
    expect(consulta.body.pedidos[0].numero).toBe(pedido.numero);

    const noExiste = await t.http.get('/api/v1/api/dispatch/IRE-9999').set('X-API-Key', apiKey);
    expect(noExiste.status).toBe(404);

    // HU-063: registrar guía — valida transportadora, guía y fecha
    const sinGuia = await t.http
      .post(`/api/v1/api/carrier-guide`)
      .set('X-API-Key', apiKey)
      .send({ numero: d.body.numero, carrierId });
    expect(sinGuia.status).toBe(400);

    const fechaMala = await t.http
      .post(`/api/v1/api/carrier-guide`)
      .set('X-API-Key', apiKey)
      .send({ numero: d.body.numero, carrierId, guia: 'G-1', fechaSalida: 'no-es-fecha' });
    expect(fechaMala.status).toBe(400);

    const carrierMalo = await t.http
      .post(`/api/v1/api/carrier-guide`)
      .set('X-API-Key', apiKey)
      .send({ numero: d.body.numero, carrierId: '00000000-0000-4000-8000-000000000000', guia: 'G-1' });
    expect(carrierMalo.status).toBe(404);

    const ok = await t.http
      .post(`/api/v1/api/carrier-guide`)
      .set('X-API-Key', apiKey)
      .send({ numero: d.body.numero, carrierId, guia: 'GUIA-ERP-7788', fechaSalida: '2026-07-24T14:00:00Z' });
    expect(ok.status).toBe(201);
    expect(ok.body.estado).toBe('DESPACHADO');
    expect(ok.body.guia).toBe('GUIA-ERP-7788');
    expect(ok.body.nombreTransporte).toBe('Transportadora API');

    // La consulta refleja la guía registrada
    const despachado = await t.http
      .get(`/api/v1/api/dispatch/${d.body.numero}`)
      .set('X-API-Key', apiKey);
    expect(despachado.body.estado).toBe('DESPACHADO');
    expect(despachado.body.transporte.guia).toBe('GUIA-ERP-7788');
  });

  it('H-4/spec §7: PUT /api/orders/{id} — solo ABIERTO y creado por API; GET /api/box', async () => {
    // Key fresca: el rate limit parametrizable (20/min por defecto, H-3)
    // es por key y la compartida ya consumió su ventana en los tests previos
    const apiUserRow = await t.dataSource.query(`SELECT id FROM users WHERE username='integracion.i11'`);
    const keyH4 = (
      await t.http
        .post('/api/v1/api-keys')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: apiUserRow[0].id, nombre: 'ERP h4' })
    ).body.clave;
    // Pedido creado por API
    const pedido = await t.http
      .post('/api/v1/api/orders')
      .set('X-API-Key', keyH4)
      .send({
        empresaId: ireId,
        clienteId,
        comercialId,
        items: [{ referencia: 'EXT-001', cantidad: 2 }],
      });
    expect(pedido.status).toBe(201);
    expect(pedido.body.createdVia ?? 'API').toBe('API');
    const pedidoId = pedido.body.id;

    // Pedido creado manualmente (flujo web) → 403 al modificar por API
    const manual = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        clienteId,
        comercialId,
        items: [{ referencia: 'EXT-001', cantidad: 1 }],
      });
    expect(manual.status).toBe(201);
    const manualRes = await t.http
      .put(`/api/v1/api/orders/${manual.body.id}`)
      .set('X-API-Key', keyH4)
      .send({
        empresaId: ireId,
        clienteId,
        items: [{ referencia: 'EXT-001', cantidad: 3 }],
      });
    expect(manualRes.status).toBe(403);

    // Modificar el pedido API: reemplaza ítems y cabecera
    const mod = await t.http
      .put(`/api/v1/api/orders/${pedidoId}`)
      .set('X-API-Key', keyH4)
      .send({
        empresaId: ireId,
        clienteId,
        comercialId,
        ciudad: 'Medellín',
        items: [
          { referencia: 'EXT-001', cantidad: 3 },
          { referencia: 'EXT-002', cantidad: 1 },
        ],
      });
    expect(mod.status).toBe(200);
    expect(mod.body.ciudad).toBe('Medellín');
    expect(mod.body.items).toHaveLength(2);
    const ext1 = mod.body.items.find((i: any) => i.codigo === 'EXT-001');
    expect(ext1.cantidad).toBe(3);

    // Ya no está ABIERTO → 409
    await t.dataSource.query(`UPDATE orders SET estado='ALISTADO' WHERE id=$1`, [pedidoId]);
    const noAbierto = await t.http
      .put(`/api/v1/api/orders/${pedidoId}`)
      .set('X-API-Key', keyH4)
      .send({
        empresaId: ireId,
        clienteId,
        items: [{ referencia: 'EXT-001', cantidad: 1 }],
      });
    expect(noAbierto.status).toBe(409);

    // GET /api/box/{boxId}: resuelve el contenido de la caja
    const box = await t.dataSource.query(
      `SELECT box_id FROM boxes ORDER BY created_at ASC LIMIT 1`,
    );
    const consultaBox = await t.http
      .get(`/api/v1/api/box/${box[0].box_id}`)
      .set('X-API-Key', keyH4);
    expect(consultaBox.status).toBe(200);
    expect(consultaBox.body.boxId).toBe(box[0].box_id);
    expect(consultaBox.body.items.length).toBeGreaterThan(0);
    const boxInexistente = await t.http
      .get('/api/v1/api/box/CJA-999999')
      .set('X-API-Key', keyH4);
    expect(boxInexistente.status).toBe(404);
  });

  it('Rate limit por API key y revocación', async () => {
    // Key fresca: el rate limit es por key (ventana de 60 s ya consumida por la otra)
    const apiUser = await t.dataSource.query(`SELECT id FROM users WHERE username='integracion.i11'`);
    const key2 = await t.http
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: apiUser[0].id, nombre: 'WMS tiendas' });
    const apiKey2 = key2.body.clave;

    process.env.EXTERNAL_API_RATE_LIMIT = '5';
    let ultimo = 0;
    for (let i = 0; i < 5; i++) {
      const r = await t.http
        .get(`/api/v1/api/products?empresaId=${ireId}`)
        .set('X-API-Key', apiKey2);
      ultimo = r.status;
    }
    expect(ultimo).toBe(200);
    const excedido = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}`)
      .set('X-API-Key', apiKey2);
    expect(excedido.status).toBe(429);
    expect(excedido.body.code).toBe('RATE_LIMIT_EXCEEDED');
    delete process.env.EXTERNAL_API_RATE_LIMIT;

    // Revocar la key → 401
    const keyId = (global as any).__keyId;
    await t.http
      .patch(`/api/v1/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ activo: false });
    const revocada = await t.http
      .get(`/api/v1/api/products?empresaId=${ireId}`)
      .set('X-API-Key', apiKey);
    expect(revocada.status).toBe(401);

    // last_used_at quedó registrado del uso previo
    const key = await t.dataSource.query(`SELECT last_used_at FROM api_keys WHERE id=$1`, [keyId]);
    expect(key[0].last_used_at).toBeTruthy();
  });
});
