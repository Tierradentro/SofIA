import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I35 — ajustes de la iteración 35:
 *  - Localización en el mapa por código, referencia cruzada o código de barras.
 *  - El Operador asigna ubicaciones (POST) pero no las modifica ni las da de baja.
 *  - Áreas adicionales por piso (varias del mismo tipo) con color propio.
 *  - Estantes con niveles individuales (2 o más, distintos entre sí).
 *  - Movimientos de inventario muestran el usuario que los registró.
 *  - Resumen de actividad del comercial (pedidos, despachos, devoluciones).
 */
describe('I35 ajustes (e2e)', () => {
  let t: TestApp;
  let tokenAdmin: string;
  let tokenGenerador: string;
  let tokenOperador: string;
  let empresaId: string;
  let productoId: string;
  let comercialId: string;
  let adminUserId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    tokenAdmin = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);

    const [adminRow] = await t.dataSource.query(`SELECT id FROM users WHERE username = $1`, [ADMIN.username]);
    adminUserId = adminRow.id;

    await t.http.post('/api/v1/users').set('Authorization', `Bearer ${tokenAdmin}`).send({
      nombre: 'Generador I35', username: 'generador.i35', email: 'generador.i35@sofia.local',
      rol: 'GENERADOR', claveInicial: 'ClaveInicial1',
    });
    await t.http.post('/api/v1/users').set('Authorization', `Bearer ${tokenAdmin}`).send({
      nombre: 'Operador I35', username: 'operador.i35', email: 'operador.i35@sofia.local',
      rol: 'OPERADOR', claveInicial: 'ClaveInicial1',
    });
    tokenGenerador = await loginAndSetPassword(t.http, 'generador.i35', 'ClaveInicial1', 'GeneradorClave9');
    tokenOperador = await loginAndSetPassword(t.http, 'operador.i35', 'ClaveInicial1', 'OperadorClave9');

    const emp = await t.http.get('/api/v1/companies').set('Authorization', `Bearer ${tokenAdmin}`);
    empresaId = emp.body.find((c: any) => c.nombre === 'IRE').id;

    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({
        empresaId,
        codigo: 'I35-001',
        descripcion: 'Producto ajustes I35',
        codigoOE: 'OE-I35-001',
        refCruzada1: 'REF-I35-AAA',
        unidadMedida: 'UND',
        precio: 12000,
      });
    expect(prod.status).toBe(201);
    productoId = prod.body.id;

    // Stock inicial del producto (la creación de pedidos valida disponibilidad)
    await t.dataSource.query(`UPDATE products SET cantidad = 20 WHERE id = $1`, [productoId]);

    // Código de barras del producto
    const bc = await t.http
      .post(`/api/v1/products/${productoId}/barcode`)
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ barcode: '7701234567890', origen: 'MANUAL' });
    expect(bc.status).toBe(201);

    // Comercial con un pedido asociado (para el resumen de actividad)
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Comercial I35', identificacion: 'C-I35' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Cliente I35', identificacion: '900-I35', ciudad: 'Cali' });
    expect(cli.status).toBe(201);

    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({
        empresaId,
        clienteId: cli.body.id,
        comercialId,
        items: [{ referencia: 'I35-001', cantidad: 2 }],
      });
    expect(pedido.status).toBe(201);
  }, 120000);

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('localiza un producto por código OE y por referencia cruzada (I35.9)', async () => {
    const porOE = await t.http
      .get('/api/v1/warehouses/locate')
      .query({ q: 'oe-i35-001' })
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(porOE.status).toBe(200);
    expect(porOE.body.product.codigo).toBe('I35-001');

    const porRef = await t.http
      .get('/api/v1/warehouses/locate')
      .query({ q: 'ref-i35-aaa' })
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(porRef.status).toBe(200);
    expect(porRef.body.product.codigo).toBe('I35-001');
  });

  it('localiza un producto por código de barras (I35.9)', async () => {
    const res = await t.http
      .get('/api/v1/warehouses/locate')
      .query({ q: '7701234567890' })
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(res.status).toBe(200);
    expect(res.body.product.codigo).toBe('I35-001');
  });

  it('el Operador asigna ubicaciones pero no las modifica ni las da de baja (I35.8)', async () => {
    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const rack = mapa.body.pisos[0].pasillos[0].zonas.find((z: any) => z.estantes.length > 0).estantes[0];

    const asignar = await t.http
      .post('/api/v1/warehouses/locations')
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ productId: productoId, rackId: rack.id, nivel: 1, cantidad: 5 });
    expect(asignar.status).toBe(201);

    const modificar = await t.http
      .patch(`/api/v1/warehouses/locations/${asignar.body.id}`)
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ productId: productoId, rackId: rack.id, nivel: 2, cantidad: 5 });
    expect(modificar.status).toBe(403);

    const baja = await t.http
      .delete(`/api/v1/warehouses/locations/${asignar.body.id}`)
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(baja.status).toBe(403);

    // Generador sí puede modificar
    const modGen = await t.http
      .patch(`/api/v1/warehouses/locations/${asignar.body.id}`)
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ productId: productoId, rackId: rack.id, nivel: 2, cantidad: 6 });
    expect(modGen.status).toBe(200);
  });

  it('configure admite áreas adicionales del mismo tipo con color propio (I35.7)', async () => {
    const payload = {
      nombre: 'Bodega Principal',
      forma: 'RECTANGULO',
      anchoM: 40,
      altoM: 30,
      pisos: [
        {
          numero: 1,
          tieneAreasFijas: true,
          areas: [
            { tipo: 'BAHIA_EMPAQUE', alias: 'Bahía Empaque 2', color: '#ff8800', permiteProductos: true },
            { tipo: 'ENTRADA', alias: 'Entrada Norte' },
          ],
          pasillos: [{ numero: 1, zonas: [{ lado: 'IZQUIERDA', estantes: [{ numero: 1, niveles: 3 }] }] }],
        },
        {
          numero: 2,
          areas: [{ tipo: 'BAHIA_TEMPORAL', alias: 'Bahía Piso 2', permiteProductos: true }],
          pasillos: [
            {
              numero: 1,
              zonas: [
                {
                  lado: 'IZQUIERDA',
                  // I35.7: niveles individuales por estante (2, 4 y 3)
                  estantes: [
                    { numero: 1, niveles: 2 },
                    { numero: 2, niveles: 4 },
                    { numero: 3, niveles: 3 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await t.http
      .post('/api/v1/warehouses/configure')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(payload);
    expect(res.status).toBe(201);

    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(mapa.status).toBe(200);
    const piso1 = mapa.body.pisos.find((p: any) => p.numero === 1);
    // I36: 3 áreas fijas (entrada, patio, bahía de empaque) + 2 adicionales
    expect(piso1.areas).toHaveLength(5);
    expect(piso1.areas.filter((a: any) => a.tipo === 'BAHIA_EMPAQUE')).toHaveLength(2);
    expect(piso1.areas.filter((a: any) => a.tipo === 'ENTRADA')).toHaveLength(2);
    const adicional = piso1.areas.find((a: any) => a.alias === 'Bahía Empaque 2');
    expect(adicional.color).toBe('#ff8800');
    expect(adicional.permiteProductos).toBe(true);

    // Piso 2 sin áreas fijas, con su área adicional
    const piso2 = mapa.body.pisos.find((p: any) => p.numero === 2);
    expect(piso2.tieneAreasFijas).toBe(false);
    expect(piso2.areas).toHaveLength(1);
    expect(piso2.areas[0].alias).toBe('Bahía Piso 2');

    // Estantes con niveles individuales
    const estantes = piso2.pasillos[0].zonas.find((z: any) => z.lado === 'IZQUIERDA').estantes;
    expect(estantes.map((e: any) => e.niveles)).toEqual([2, 4, 3]);
  });

  it('mover cajón tipo área también actualiza su color (I35.7)', async () => {
    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const area = mapa.body.pisos[0].areas.find((a: any) => a.alias === 'Bahía Empaque 2');
    const res = await t.http
      .patch(`/api/v1/warehouses/area/${area.id}/posicion`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ posX: 15, posY: 8, color: '#00aaff' });
    expect(res.status).toBe(200);
    expect(res.body.color).toBe('#00aaff');

    const mapa2 = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const area2 = mapa2.body.pisos[0].areas.find((a: any) => a.alias === 'Bahía Empaque 2');
    expect(area2.color).toBe('#00aaff');
    expect(area2.posX).toBe(15);
  });

  it('los movimientos de inventario muestran el usuario que los registró (I35.5)', async () => {
    const { MovementsService } = await import('../src/modules/movements/movements.service');
    const service = t.app.get(MovementsService);
    await service.apply({
      productId: productoId,
      tipo: 'INGRESO_APROBADO' as any,
      cantidadDelta: 4,
      docTipo: 'INGRESO',
      docId: 'ING-I35-1',
      usuarioId: adminUserId,
    });

    const res = await t.http
      .get(`/api/v1/movements/producto/${productoId}`)
      .set('Authorization', `Bearer ${tokenGenerador}`);
    expect(res.status).toBe(200);
    const mov = res.body.find((m: any) => m.docId === 'ING-I35-1');
    expect(mov).toBeDefined();
    expect(mov.usuarioUsername).toBe(ADMIN.username);
    expect(mov.usuarioNombre).toBeTruthy();
  });

  it('el resumen del comercial incluye sus pedidos, despachos y devoluciones (I35.3)', async () => {
    const res = await t.http
      .get(`/api/v1/comerciales/${comercialId}/resumen`)
      .set('Authorization', `Bearer ${tokenGenerador}`);
    expect(res.status).toBe(200);
    expect(res.body.comercial.nombre).toBe('Comercial I35');
    expect(res.body.pedidos.total).toBe(1);
    expect(res.body.pedidos.recientes[0].numero).toMatch(/^IRE-/);
    expect(res.body.despachos.total).toBe(0);
    expect(res.body.devoluciones.total).toBe(0);

    // RBAC: el Operador no consulta el resumen
    const op = await t.http
      .get(`/api/v1/comerciales/${comercialId}/resumen`)
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(op.status).toBe(403);
  });
});
