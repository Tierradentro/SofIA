import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I12 — EP-10: consultas y tablero del comercial.
 * HU-053 (consulta de caja por QR: productos, cantidades, cliente, empresas,
 * documentos y fecha), HU-054 (consulta de despachos con filtros por cliente,
 * empresa, fecha, documento, caja y guía) y M02 (tablero del comercial: solo
 * ve pedidos, despachos y PQRS asociados a su comercial).
 */
describe('Consultas y tablero del comercial (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let comercial1Token: string;
  let comercial2Token: string;
  let ireId: string;
  let icvId: string;
  let clienteId: string;
  let comercial1Id: string;
  let comercial2Id: string;
  let carrierId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);
    const empresas = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;
    icvId = empresas.find((e: any) => e.nombre === 'ICV').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente Consultas', identificacion: '900121212', ciudad: 'Bogotá', direccion: 'Cra 7 # 40-10' });
    clienteId = cli.body.id;

    const c1 = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Uno', identificacion: 'C-Q01' });
    comercial1Id = c1.body.id;
    const c2 = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Dos', identificacion: 'C-Q02' });
    comercial2Id = c2.body.id;

    const car = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Transportadora Consultas', tipo: 'EXTERNA', identificacion: '890444' });
    carrierId = car.body.id;

    for (const [username, rol, extra] of [
      ['generador.i12', 'GENERADOR', {}],
      ['operador.i12', 'OPERADOR', {}],
      ['comercial1.i12', 'COMERCIAL', { comercialId: comercial1Id }],
      ['comercial2.i12', 'COMERCIAL', { comercialId: comercial2Id }],
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
          ...(extra as any),
        });
    }
    generadorToken = await loginAndSetPassword(t.http, 'generador.i12', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i12', 'ClaveInicial1', 'ClaveNueva123');
    comercial1Token = await loginAndSetPassword(t.http, 'comercial1.i12', 'ClaveInicial1', 'ClaveNueva123');
    comercial2Token = await loginAndSetPassword(t.http, 'comercial2.i12', 'ClaveInicial1', 'ClaveNueva123');

    // Productos IRE e ICV
    const p1 = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, codigo: 'QRY-001', descripcion: 'Producto QRY-001', unidadMedida: 'UND', precio: 8000 });
    await t.dataSource.query(`UPDATE products SET cantidad=12 WHERE id=$1`, [p1.body.id]);
    await t.http
      .post(`/api/v1/products/${p1.body.id}/barcode`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ barcode: '7512001', origen: 'MANUAL' });
    const p2 = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: icvId, codigo: 'QRY-002', descripcion: 'Producto QRY-002', unidadMedida: 'UND', precio: 6000 });
    await t.dataSource.query(`UPDATE products SET cantidad=6 WHERE id=$1`, [p2.body.id]);

    // Pedido del Comercial Uno (comercialId automático), alistado y aprobado con factura
    const ped = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${comercial1Token}`)
      .send({
        empresaId: ireId,
        clienteId,
        items: [{ referencia: 'QRY-001', cantidad: 3 }],
      });
    expect(ped.status).toBe(201);
    expect(ped.body.comercialId).toBe(comercial1Id);
    const pedId = ped.body.id;
    const scan = await t.http
      .post(`/api/v1/orders/${pedId}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7512001', cantidad: 3 });
    expect(scan.status).toBe(201);
    await t.http.post(`/api/v1/orders/${pedId}/finalizar-picking`).set('Authorization', `Bearer ${operadorToken}`);
    await t.dataSource.query(
      `UPDATE orders SET estado='APROBADO', aprobado_at=now(), numero_factura='FV-QRY-1' WHERE id=$1`,
      [pedId],
    );

    // Pedido ICV del Generador con comercial 1 asignado
    const ped2 = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: icvId, clienteId, comercialId: comercial1Id, items: [{ referencia: 'QRY-002', cantidad: 2 }] });
    const scan2 = await t.http
      .post(`/api/v1/orders/${ped2.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: 'QRY-002', cantidad: 2 });
    expect(scan2.status).toBe(201);
    await t.http.post(`/api/v1/orders/${ped2.body.id}/finalizar-picking`).set('Authorization', `Bearer ${operadorToken}`);
    await t.dataSource.query(`UPDATE orders SET estado='APROBADO', aprobado_at=now(), numero_factura='FV-QRY-2' WHERE id=$1`, [ped2.body.id]);

    // Pedido del Comercial Dos (para el scoping negativo)
    const pedOtro = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${comercial2Token}`)
      .send({ empresaId: ireId, clienteId, items: [{ referencia: 'QRY-001', cantidad: 1 }] });
    expect(pedOtro.status).toBe(201);
    (global as any).__pedidoOtro = pedOtro.body;

    // Despacho multiempresa del cliente con guía registrada
    const d = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedId });
    const dId = d.body.id;
    await t.http
      .post(`/api/v1/dispatches/${dId}/orders`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [ped2.body.id] });
    await t.http.post(`/api/v1/dispatches/${dId}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);
    const box = await t.http.post(`/api/v1/dispatches/${dId}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http.post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/scan`).set('Authorization', `Bearer ${operadorToken}`).send({ codigo: '7512001', cantidad: 3 });
    await t.http.post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/scan`).set('Authorization', `Bearer ${operadorToken}`).send({ codigo: 'QRY-002', cantidad: 2 });
    await t.http.post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/cerrar`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http.post(`/api/v1/dispatches/${dId}/finalizar-empaque`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'EXTERNA', carrierId, guia: 'GUIA-QRY-77' });

    (global as any).__pedido = ped.body;
    (global as any).__despacho = d.body;
    (global as any).__box = box.body;

    // Caso PQRS asociado al Comercial Uno
    const caso = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        clienteId, comercialId: comercial1Id, codigo: 'QRY-001', cantidad: 1,
        motivoCodigo: 'G08', descripcionCaso: 'Falla reportada por el cliente',
        orderId: pedId,
      });
    expect(caso.status).toBe(201);
    (global as any).__caso = caso.body;
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-053: consulta de caja muestra productos, cantidades, cliente, empresas, documentos y fecha', async () => {
    const box = (global as any).__box;
    const res = await t.http
      .get(`/api/v1/boxes/${box.boxId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(res.status).toBe(200);
    // Productos y cantidades
    expect(res.body.items).toHaveLength(2);
    const i1 = res.body.items.find((i: any) => i.codigo === 'QRY-001');
    expect(i1.cantidad).toBe(3);
    expect(i1.descripcion).toContain('QRY-001');
    expect(i1.numeroFactura).toBe('FV-QRY-1');
    // Cliente
    expect(res.body.cliente.nombre).toBe('Cliente Consultas');
    // Empresas (caja multiempresa HU-034)
    expect(res.body.empresas.sort()).toEqual(['ICV', 'IRE']);
    // Documentos (facturas de los pedidos)
    expect(res.body.documentos.sort()).toEqual(['FV-QRY-1', 'FV-QRY-2']);
    // Fecha (cierre de la caja)
    expect(res.body.fecha).toBeTruthy();
  });

  it('HU-054: filtros por cliente, empresa, fecha, documento, caja y guía', async () => {
    const d = (global as any).__despacho;
    // Ventana amplia para evitar ambigüedad de zona horaria (UTC vs local)
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // Por cliente
    const porCliente = await t.http
      .get(`/api/v1/dispatches?clienteId=${clienteId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porCliente.body.map((x: any) => x.id)).toContain(d.id);

    // Por empresa (ICV participa vía pedido asociado)
    const porEmpresa = await t.http
      .get(`/api/v1/dispatches?empresaId=${icvId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porEmpresa.body.map((x: any) => x.id)).toContain(d.id);

    // Por fecha (hoy incluye; rango pasado no)
    const porFecha = await t.http
      .get(`/api/v1/dispatches?fechaDesde=${ayer}&fechaHasta=${manana}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porFecha.body.map((x: any) => x.id)).toContain(d.id);
    const fechaPasada = await t.http
      .get('/api/v1/dispatches?fechaDesde=2020-01-01&fechaHasta=2020-01-02')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fechaPasada.body.map((x: any) => x.id)).not.toContain(d.id);

    // Por documento (factura de pedido asociado)
    const porDoc = await t.http
      .get('/api/v1/dispatches?documento=FV-QRY-2')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porDoc.body.map((x: any) => x.id)).toEqual([d.id]);
    const docNo = await t.http
      .get('/api/v1/dispatches?documento=FV-INEXISTENTE')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(docNo.body).toHaveLength(0);

    // Por caja
    const box = (global as any).__box;
    const porCaja = await t.http
      .get(`/api/v1/dispatches?boxId=${box.boxId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porCaja.body.map((x: any) => x.id)).toEqual([d.id]);

    // Por guía
    const porGuia = await t.http
      .get('/api/v1/dispatches?guia=GUIA-QRY-77')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(porGuia.body.map((x: any) => x.id)).toEqual([d.id]);
    expect(porGuia.body[0].estado).toBe('DESPACHADO');
  });

  it('M02 tablero: el Comercial solo ve sus pedidos, despachos y PQRS', async () => {
    const pedido = (global as any).__pedido;
    const pedidoOtro = (global as any).__pedidoOtro;
    const despacho = (global as any).__despacho;
    const caso = (global as any).__caso;

    // Pedidos: comercial1 ve el suyo, no el de comercial2
    const pedidos1 = await t.http
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${comercial1Token}`);
    const ids1 = pedidos1.body.map((p: any) => p.id);
    expect(ids1).toContain(pedido.id);
    expect(ids1).not.toContain(pedidoOtro.id);
    const detalle1 = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${comercial1Token}`);
    expect(detalle1.status).toBe(200);

    // Comercial2: no ve el pedido de comercial1 ni su detalle
    const pedidos2 = await t.http
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${comercial2Token}`);
    expect(pedidos2.body.map((p: any) => p.id)).not.toContain(pedido.id);
    const detalle2 = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${comercial2Token}`);
    expect(detalle2.status).toBe(404);

    // Despachos: comercial1 ve el despacho (contiene sus pedidos); comercial2 no
    const dsp1 = await t.http
      .get('/api/v1/dispatches')
      .set('Authorization', `Bearer ${comercial1Token}`);
    expect(dsp1.body.map((x: any) => x.id)).toContain(despacho.id);
    const dspDet1 = await t.http
      .get(`/api/v1/dispatches/${despacho.id}`)
      .set('Authorization', `Bearer ${comercial1Token}`);
    expect(dspDet1.status).toBe(200);

    const dsp2 = await t.http
      .get('/api/v1/dispatches')
      .set('Authorization', `Bearer ${comercial2Token}`);
    expect(dsp2.body.map((x: any) => x.id)).not.toContain(despacho.id);
    const dspDet2 = await t.http
      .get(`/api/v1/dispatches/${despacho.id}`)
      .set('Authorization', `Bearer ${comercial2Token}`);
    expect(dspDet2.status).toBe(404);

    // PQRS: comercial1 ve su caso; comercial2 no
    const pqrs1 = await t.http
      .get('/api/v1/pqrs')
      .set('Authorization', `Bearer ${comercial1Token}`);
    expect(pqrs1.body.map((c: any) => c.id)).toContain(caso.id);
    const pqrsDet2 = await t.http
      .get(`/api/v1/pqrs/${caso.id}`)
      .set('Authorization', `Bearer ${comercial2Token}`);
    expect(pqrsDet2.status).toBe(404);

    // El Generador ve todo sin restricción
    const todoPedidos = await t.http
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(todoPedidos.body.length).toBeGreaterThanOrEqual(3);
    const todoPqrs = await t.http
      .get('/api/v1/pqrs')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(todoPqrs.body.map((c: any) => c.id)).toContain(caso.id);
  });
});
