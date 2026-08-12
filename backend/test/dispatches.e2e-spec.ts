import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I8 — EP-08/M09+M10: despachos y cajas.
 * HU-033/034 (crear y asociar pedidos del mismo cliente, multiempresa,
 * consecutivo GLOBAL DES-###### B-1), HU-035/036/037 (cajas CJA-######
 * globales, escaneo con conteo y excedentes, cierre con descuento
 * transaccional de Cantidad y bloqueada), HU-038 (etiqueta QR con solo
 * box_id), HU-039/040 (transporte externa/interna), HU-041 (aprobación
 * de parcial con motivo), HU-042/D-06 (despacho adicional), cancelación
 * con reversión de movimientos, M10 (consulta de caja por box_id).
 */
describe('Despachos y cajas (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let comercialToken: string;
  let ireId: string;
  let icvId: string;
  let clienteId: string;
  let cliente2Id: string;
  let comercialId: string;
  let carrierExtId: string;
  let carrierIntId: string;

  async function crearProducto(
    codigo: string,
    cantidad: number,
    empresaId: string,
    barcode?: string,
  ) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId,
        codigo,
        descripcion: `Producto ${codigo}`,
        unidadMedida: 'UND',
        precio: 7000,
      });
    expect(res.status).toBe(201);
    const producto = res.body;
    if (cantidad > 0) {
      await t.dataSource.query(`UPDATE products SET cantidad=$1 WHERE id=$2`, [
        cantidad,
        producto.id,
      ]);
    }
    if (barcode) {
      const b = await t.http
        .post(`/api/v1/products/${producto.id}/barcode`)
        .set('Authorization', `Bearer ${generadorToken}`)
        .send({ barcode, origen: 'MANUAL' });
      expect(b.status).toBe(201);
    }
    return producto;
  }

  /** Pedido APROBADO: se alista por API y se aprueba directo (el flujo de
   * factura HU-032 ya se probó en I7; aquí el foco es el despacho). */
  async function crearPedidoAprobado(
    empresaId: string,
    items: { referencia: string; cantidad: number; scanCode: string }[],
    cliente: string = clienteId,
  ) {
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId,
        clienteId: cliente,
        comercialId,
        items: items.map((i) => ({ referencia: i.referencia, cantidad: i.cantidad })),
      });
    expect(pedido.status).toBe(201);
    const id = pedido.body.id;
    for (const i of items) {
      const scan = await t.http
        .post(`/api/v1/orders/${id}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ modo: 'COMPLETO', codigo: i.scanCode, cantidad: i.cantidad });
      expect(scan.status).toBe(201);
    }
    const fin = await t.http
      .post(`/api/v1/orders/${id}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    await t.dataSource.query(
      `UPDATE orders SET estado='APROBADO', aprobado_at=now() WHERE id=$1`,
      [id],
    );
    const aprobado = await t.http
      .get(`/api/v1/orders/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(aprobado.body.estado).toBe('APROBADO');
    return aprobado.body;
  }

  async function stock(codigo: string, empresaId: string) {
    const rows = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE codigo=$1 AND empresa_id=$2`,
      [codigo, empresaId],
    );
    return rows[0];
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    const empresas = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;
    icvId = empresas.find((e: any) => e.nombre === 'ICV').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Taller Central', identificacion: '900555111', ciudad: 'Bogotá', direccion: 'Av 1 # 2-3' });
    clienteId = cli.body.id;
    const cli2 = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Otro Cliente', identificacion: '900555222', ciudad: 'Cali', direccion: 'Calle 9' });
    cliente2Id = cli2.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Despachos', identificacion: 'C-D08' });
    comercialId = com.body.id;

    for (const [username, rol, extra] of [
      ['generador.i8', 'GENERADOR', {}],
      ['operador.i8', 'OPERADOR', {}],
      ['comercial.i8', 'COMERCIAL', { comercialId }],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i8', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i8', 'ClaveInicial1', 'ClaveNueva123');
    comercialToken = await loginAndSetPassword(t.http, 'comercial.i8', 'ClaveInicial1', 'ClaveNueva123');

    // Transportadoras (HU-008)
    const ext = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Transportes Rápidos', tipo: 'EXTERNA', identificacion: '890111' });
    expect(ext.status).toBe(201);
    carrierExtId = ext.body.id;
    const int = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Flota Propia', tipo: 'INTERNA', identificacion: '890222' });
    expect(int.status).toBe(201);
    carrierIntId = int.body.id;

    // Productos: IRE ×2, ICV ×1
    await crearProducto('DSP-001', 20, ireId, '7509001');
    await crearProducto('DSP-002', 10, ireId);
    await crearProducto('DSP-003', 8, icvId, '7509003');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-033/B-1: crea despacho desde pedido APROBADO con consecutivo global (DES-000001)', async () => {
    // RBAC: Operador no puede crear despachos
    const prohibido = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ orderId: ireId });
    expect(prohibido.status).toBe(403);

    const pedidoA = await crearPedidoAprobado(ireId, [
      { referencia: 'DSP-001', cantidad: 3, scanCode: '7509001' },
      { referencia: 'DSP-002', cantidad: 2, scanCode: 'DSP-002' },
    ]);

    const res = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoA.id });
    expect(res.status).toBe(201);
    expect(res.body.numero).toBe('DES-000001');
    expect(res.body.estado).toBe('CREADO');
    expect(res.body.clienteId).toBe(clienteId);
    expect(res.body.pedidos).toHaveLength(1);
    expect(res.body.pedidos[0].items[0].pendienteDespachar).toBe(3);

    // Pedido inexistente → 404; pedido no APROBADO → 400
    const noExiste = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: '00000000-0000-4000-8000-000000000000' });
    expect(noExiste.status).toBe(404);

    const abierto = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, comercialId, items: [{ referencia: 'DSP-001', cantidad: 1 }] });
    const noAprobado = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: abierto.body.id });
    expect(noAprobado.status).toBe(400);
    expect(noAprobado.body.message).toContain('APROBADO');

    // El pedido A ya está en un despacho activo → no se puede re-usar
    const duplicado = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoA.id });
    expect(duplicado.status).toBe(400);
    expect(duplicado.body.message).toContain('despacho activo');

    (global as any).__pedidoA = pedidoA;
    (global as any).__dispatch1 = res.body;
  });

  it('QA Func. 4.1/4.3: el despacho hereda la dirección del pedido, la ajusta y lista empresas como etiqueta', async () => {
    // Reutiliza DES-000001 (creado en el test anterior) para no consumir
    // otro consecutivo de la serie global (los tests siguientes la verifican)
    const dispatch1 = (global as any).__dispatch1;
    // Heredó la dirección principal del cliente (migrada del alta)
    expect(dispatch1.direccionDespacho).toBe('Av 1 # 2-3');

    // El Generador ajusta la dirección en el despacho (estado CREADO)
    const ajuste = await t.http
      .patch(`/api/v1/dispatches/${dispatch1.id}/direccion`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ direccion: 'Bodega Occidente Bod 12' });
    expect(ajuste.status).toBe(200);
    expect(ajuste.body.direccionDespacho).toBe('Bodega Occidente Bod 12');

    // Queda auditado
    const logs = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE accion='AJUSTAR_DIRECCION' AND registro_id=$1`,
      [dispatch1.id],
    );
    expect(logs.length).toBe(1);

    // RBAC: Operador no ajusta direcciones
    const porOperador = await t.http
      .patch(`/api/v1/dispatches/${dispatch1.id}/direccion`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ direccion: 'No debe quedar' });
    expect(porOperador.status).toBe(403);

    // QA Func. 4.3: el listado trae las empresas como etiqueta
    const lista = await t.http
      .get('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`);
    const fila1 = lista.body.find((d: any) => d.id === dispatch1.id);
    expect(fila1.empresas).toEqual(['IRE']);
  });

  it('HU-034: asocia pedido ICV del mismo cliente (multiempresa); rechaza otro cliente', async () => {
    const d1 = (global as any).__dispatch1;
    const pedidoIcv = await crearPedidoAprobado(icvId, [
      { referencia: 'DSP-003', cantidad: 2, scanCode: '7509003' },
    ]);
    (global as any).__pedidoIcv = pedidoIcv;

    const asoc = await t.http
      .post(`/api/v1/dispatches/${d1.id}/orders`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [pedidoIcv.id] });
    expect(asoc.status).toBe(201);
    expect(asoc.body.pedidos).toHaveLength(2);
    const empresas = asoc.body.pedidos.map((p: any) => p.empresaPedido);
    expect(empresas).toContain(ireId);
    expect(empresas).toContain(icvId);

    // Otro cliente → 400
    const pedidoOtro = await crearPedidoAprobado(
      ireId,
      [{ referencia: 'DSP-001', cantidad: 1, scanCode: '7509001' }],
      cliente2Id,
    );
    const otroCliente = await t.http
      .post(`/api/v1/dispatches/${d1.id}/orders`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [pedidoOtro.id] });
    // M-3: conflicto de regla de negocio → 409
    expect(otroCliente.status).toBe(409);
    expect(otroCliente.body.message).toContain('mismo cliente');

    // B-1: serie global compartida — el segundo despacho continúa la misma
    // serie sin importar la empresa del pedido
    const dIcv = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoOtro.id });
    expect(dIcv.status).toBe(201);
    expect(dIcv.body.numero).toBe('DES-000002'); // serie global (B-1)
    await t.http
      .post(`/api/v1/dispatches/${dIcv.body.id}/cancelar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Solo prueba de consecutivo' });
  });

  it('M09 paso 2: aprobar → ABIERTO; devolver → PENDIENTE_CORRECCION; re-aprobar', async () => {
    const d1 = (global as any).__dispatch1;

    const aprob = await t.http
      .post(`/api/v1/dispatches/${d1.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('ABIERTO');

    // No se puede aprobar dos veces
    const otraVez = await t.http
      .post(`/api/v1/dispatches/${d1.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(otraVez.status).toBe(400);

    // Operador devuelve con motivo (error de productos)
    const dev = await t.http
      .post(`/api/v1/dispatches/${d1.id}/devolver`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ motivo: 'Pedido ICV iba en otro despacho' });
    expect(dev.status).toBe(201);
    expect(dev.body.estado).toBe('PENDIENTE_CORRECCION');

    // En corrección se pueden retirar pedidos
    const pedidoIcv = (global as any).__pedidoIcv;
    const retirar = await t.http
      .delete(`/api/v1/dispatches/${d1.id}/orders/${pedidoIcv.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(retirar.status).toBe(200);
    expect(retirar.body.pedidos).toHaveLength(1);

    // Se re-asocia y se aprueba de nuevo
    await t.http
      .post(`/api/v1/dispatches/${d1.id}/orders`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [pedidoIcv.id] });
    const reAprob = await t.http
      .post(`/api/v1/dispatches/${d1.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(reAprob.status).toBe(201);
    expect(reAprob.body.estado).toBe('ABIERTO');
  });

  it('HU-035/036/037: cajas CJA-###### globales, escaneo con conteo y cierre transaccional', async () => {
    const d1 = (global as any).__dispatch1;

    // Caja 1 y 2: consecutivo GLOBAL CJA-######
    const b1 = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(b1.status).toBe(201);
    expect(b1.body.boxId).toBe('CJA-000001');
    expect(b1.body.numeroEnDespacho).toBe(1);
    const b2 = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(b2.body.boxId).toBe('CJA-000002');
    expect(b2.body.numeroEnDespacho).toBe(2);

    // Escaneo por barcode (DSP-001 x2 en caja 1): SOLO cuenta, no descuenta
    const antes = await stock('DSP-001', ireId);
    const scan1 = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509001', cantidad: 2 });
    expect(scan1.status).toBe(201);
    expect(scan1.body.pendienteRestante).toBe(1);
    let despues = await stock('DSP-001', ireId);
    expect(despues.cantidad).toBe(antes.cantidad); // la cantidad no baja hasta cerrar la caja
    expect(despues.cantidad_bloqueada).toBe(antes.cantidad_bloqueada);

    // Escaneo por código propio (DSP-002 x2 en caja 1)
    const scan2 = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'DSP-002', cantidad: 2 });
    expect(scan2.status).toBe(201);

    // Excedente → 400 (solo queda 1 de DSP-001 y se intentan 2)
    const excedente = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509001', cantidad: 2 });
    expect(excedente.status).toBe(400);
    expect(excedente.body.message).toContain('Excedente');

    // Código desconocido → 400
    const desconocido = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'XXXXXX' });
    expect(desconocido.status).toBe(400);

    // Caja 2: resto de DSP-001 (1) + DSP-003 ICV (2, cross-empresa HU-034)
    await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b2.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509001', cantidad: 1 });
    const scanIcv = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b2.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509003', cantidad: 2 });
    expect(scanIcv.status).toBe(201);

    // No se puede cerrar una caja vacía (creamos una tercera)
    const b3 = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const vacia = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b3.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(vacia.status).toBe(400);
    expect(vacia.body.message).toContain('vacía');

    // Cerrar caja 1: descuento transaccional de Cantidad y bloqueada
    const icvAntes = await stock('DSP-003', icvId);
    const cierre1 = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b1.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(cierre1.status).toBe(201);
    expect(cierre1.body.estado).toBe('CERRADA');
    expect(cierre1.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    despues = await stock('DSP-001', ireId);
    expect(despues.cantidad).toBe(antes.cantidad - 2);
    expect(despues.cantidad_bloqueada).toBe(antes.cantidad_bloqueada - 2);
    const dsp002 = await stock('DSP-002', ireId);
    expect(dsp002.cantidad).toBe(8);
    expect(dsp002.cantidad_bloqueada).toBe(0);

    // Movimientos DESPACHO_CIERRE_CAJA con doc DESPACHO
    const movs = await t.dataSource.query(
      `SELECT tipo, cantidad_delta, cantidad_bloqueada_delta FROM inventory_movements
       WHERE doc_tipo='DESPACHO' AND doc_id=$1 AND tipo='DESPACHO_CIERRE_CAJA'`,
      [d1.id],
    );
    expect(movs).toHaveLength(2);
    for (const m of movs) {
      expect(m.cantidad_delta).toBeLessThan(0);
      expect(m.cantidad_bloqueada_delta).toBeLessThan(0);
    }

    // cantidad_despachada acumulada en las líneas de pedido
    const pedidoA = (global as any).__pedidoA;
    const ois = await t.dataSource.query(
      `SELECT codigo, cantidad_despachada FROM order_items WHERE order_id=$1 ORDER BY codigo`,
      [pedidoA.id],
    );
    expect(ois.find((o: any) => o.codigo === 'DSP-001').cantidad_despachada).toBe(2);
    expect(ois.find((o: any) => o.codigo === 'DSP-002').cantidad_despachada).toBe(2);

    // No se puede escanear en caja cerrada
    const enCerrada = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509001', cantidad: 1 });
    expect(enCerrada.status).toBe(400);

    // Cerrar caja 2 (descuenta ICV también)
    const cierre2 = await t.http
      .post(`/api/v1/dispatches/${d1.id}/boxes/${b2.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(cierre2.status).toBe(201);
    const icvDespues = await stock('DSP-003', icvId);
    expect(icvDespues.cantidad).toBe(icvAntes.cantidad - 2);
    expect(icvDespues.cantidad_bloqueada).toBe(icvAntes.cantidad_bloqueada - 2);

    (global as any).__boxes = { b1: b1.body, b2: b2.body, b3: b3.body };
  });

  it('HU-038 + M10: etiqueta QR con solo box_id, reimpresión y consulta de caja', async () => {
    const d1 = (global as any).__dispatch1;
    const { b1 } = (global as any).__boxes;

    const etq = await t.http
      .get(`/api/v1/dispatches/${d1.id}/boxes/${b1.id}/etiqueta`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(etq.status).toBe(200);
    expect(etq.body.boxId).toBe('CJA-000001');
    expect(etq.body.despachoNumero).toBe('DES-000001');
    expect(etq.body.qrDataUrl).toMatch(/^data:image\/png;base64,/);

    // Reimpresión (HU-038): mismo boxId, nuevo QR
    const reimp = await t.http
      .get(`/api/v1/dispatches/${d1.id}/boxes/${b1.id}/etiqueta`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(reimp.status).toBe(200);
    expect(reimp.body.boxId).toBe('CJA-000001');

    // M10: consulta de caja por box_id (lo que contiene el QR)
    const consulta = await t.http
      .get('/api/v1/boxes/CJA-000001')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(consulta.status).toBe(200);
    expect(consulta.body.estado).toBe('CERRADA');
    expect(consulta.body.despacho.numero).toBe('DES-000001');
    expect(consulta.body.items).toHaveLength(2);
    expect(consulta.body.items.map((i: any) => i.codigo).sort()).toEqual(['DSP-001', 'DSP-002']);
    expect(consulta.body.items[0].pedido).toMatch(/^IRE-/);

    const noExiste = await t.http
      .get('/api/v1/boxes/CJA-999999')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(noExiste.status).toBe(404);
  });

  it('M09 paso 4/5: finalizar empaque completo y transporte EXTERNA con guía (HU-039)', async () => {
    const d1 = (global as any).__dispatch1;
    const { b3 } = (global as any).__boxes;

    // Hay una caja ABIERTA (b3, vacía) → no se puede finalizar
    const conAbierta = await t.http
      .post(`/api/v1/dispatches/${d1.id}/finalizar-empaque`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(conAbierta.status).toBe(400);
    expect(conAbierta.body.message).toContain('ABIERTA');

    // Cancelamos la caja vacía vía SQL (no hay endpoint de eliminar caja en M09)
    await t.dataSource.query(`DELETE FROM boxes WHERE id=$1`, [b3.id]);

    const fin = await t.http
      .post(`/api/v1/dispatches/${d1.id}/finalizar-empaque`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    expect(fin.body.empaqueFinalizado).toBe(true);
    expect(fin.body.estado).toBe('ABIERTO'); // sin pendientes: no es parcial
    expect(fin.body.pendientes).toHaveLength(0);

    // Transporte EXTERNA sin transportadora / sin guía → 400
    const sinCarrier = await t.http
      .post(`/api/v1/dispatches/${d1.id}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'EXTERNA', guia: 'GUIA-1' });
    expect(sinCarrier.status).toBe(400);
    const sinGuia = await t.http
      .post(`/api/v1/dispatches/${d1.id}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'EXTERNA', carrierId: carrierExtId });
    expect(sinGuia.status).toBe(400);
    expect(sinGuia.body.message).toContain('guía');
    // Transportadora INTERNA no sirve para salida EXTERNA
    const carrierErroneo = await t.http
      .post(`/api/v1/dispatches/${d1.id}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'EXTERNA', carrierId: carrierIntId, guia: 'G-1' });
    expect(carrierErroneo.status).toBe(400);

    const ok = await t.http
      .post(`/api/v1/dispatches/${d1.id}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'EXTERNA', carrierId: carrierExtId, guia: 'TR-887766' });
    expect(ok.status).toBe(201);
    expect(ok.body.estado).toBe('DESPACHADO');
    expect(ok.body.nombreTransporte).toBe('Transportes Rápidos');
    expect(ok.body.guia).toBe('TR-887766');
    expect(ok.body.fechaSalida).toBeTruthy();
  });

  it('HU-041 + HU-039/040: parcial requiere aprobación con motivo y sale por INTERNA', async () => {
    const pedidoP = await crearPedidoAprobado(ireId, [
      { referencia: 'DSP-001', cantidad: 5, scanCode: '7509001' },
    ]);
    (global as any).__pedidoP = pedidoP;

    const d = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoP.id });
    expect(d.status).toBe(201);
    const dId = d.body.id;
    (global as any).__dispatchParcial = d.body;

    await t.http.post(`/api/v1/dispatches/${dId}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);
    const box = await t.http
      .post(`/api/v1/dispatches/${dId}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(box.body.boxId).toMatch(/^CJA-\d{6}$/);

    // Solo se empacan 3 de 5
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509001', cantidad: 3 });
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);

    const fin = await t.http
      .post(`/api/v1/dispatches/${dId}/finalizar-empaque`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    expect(fin.body.estado).toBe('PARCIAL');
    expect(fin.body.pendientes).toHaveLength(1);
    expect(fin.body.pendientes[0].pendiente).toBe(2);

    // Sin aprobación del Generador no se puede registrar transporte
    const sinAprob = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia' });
    expect(sinAprob.status).toBe(400);
    expect(sinAprob.body.message).toContain('HU-041');

    // Aprobación sin motivo → 400 (validación)
    const sinMotivo = await t.http
      .post(`/api/v1/dispatches/${dId}/aprobar-parcial`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: '' });
    expect(sinMotivo.status).toBe(400);

    const aprob = await t.http
      .post(`/api/v1/dispatches/${dId}/aprobar-parcial`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Cliente urgente: sale lo empacado hoy' });
    expect(aprob.status).toBe(201);
    expect(aprob.body.parcialMotivo).toContain('urgente');

    // INTERNA sin nombre → 400; con nombre → DESPACHADO (HU-040)
    const sinNombre = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA' });
    expect(sinNombre.status).toBe(400);
    const ok = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia', guia: 'INT-001' });
    expect(ok.status).toBe(201);
    expect(ok.body.estado).toBe('DESPACHADO');
    expect(ok.body.nombreTransporte).toBe('Flota Propia');
  });

  it('HU-042/D-06: despacho adicional completa el parcial', async () => {
    const dParcial = (global as any).__dispatchParcial;

    const adic = await t.http
      .post(`/api/v1/dispatches/${dParcial.id}/completar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(adic.status).toBe(201);
    expect(adic.body.despachoOrigenId).toBe(dParcial.id);
    expect(adic.body.estado).toBe('CREADO');
    expect(adic.body.pedidos).toHaveLength(1);
    expect(adic.body.pendientes[0].pendiente).toBe(2);
    const adicId = adic.body.id;

    // Ciclo completo del adicional
    await t.http.post(`/api/v1/dispatches/${adicId}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);
    const box = await t.http
      .post(`/api/v1/dispatches/${adicId}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${adicId}/boxes/${box.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509001', cantidad: 2 });
    await t.http
      .post(`/api/v1/dispatches/${adicId}/boxes/${box.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const fin = await t.http
      .post(`/api/v1/dispatches/${adicId}/finalizar-empaque`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.body.estado).toBe('ABIERTO'); // completo: sin pendientes
    const salida = await t.http
      .post(`/api/v1/dispatches/${adicId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'EXTERNA', carrierId: carrierExtId, guia: 'TR-990011' });
    expect(salida.status).toBe(201);
    expect(salida.body.estado).toBe('DESPACHADO');

    // La línea del pedido quedó totalmente despachada (3 + 2)
    const pedidoP = (global as any).__pedidoP;
    const oi = await t.dataSource.query(
      `SELECT cantidad_alistada, cantidad_despachada FROM order_items WHERE order_id=$1`,
      [pedidoP.id],
    );
    expect(oi[0].cantidad_alistada).toBe(5);
    expect(oi[0].cantidad_despachada).toBe(5);

    // Ya no hay pendientes: completar de nuevo → 400
    const otraVez = await t.http
      .post(`/api/v1/dispatches/${dParcial.id}/completar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(otraVez.status).toBe(400);
  });

  it('Cancelación: revierte movimientos de cajas cerradas y restaura existencias', async () => {
    const antes = await stock('DSP-001', ireId);
    const pedidoC = await crearPedidoAprobado(ireId, [
      { referencia: 'DSP-001', cantidad: 2, scanCode: '7509001' },
    ]);
    const d = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoC.id });
    const dId = d.body.id;
    await t.http.post(`/api/v1/dispatches/${dId}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);
    const box = await t.http
      .post(`/api/v1/dispatches/${dId}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7509001', cantidad: 2 });
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);

    const trasCierre = await stock('DSP-001', ireId);
    expect(trasCierre.cantidad).toBe(antes.cantidad - 2);
    expect(trasCierre.cantidad_bloqueada).toBe(antes.cantidad_bloqueada); // 2 del bloqueo de este pedido menos 2 descontadas

    const cancel = await t.http
      .post(`/api/v1/dispatches/${dId}/cancelar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Error de consolidación' });
    expect(cancel.status).toBe(201);
    expect(cancel.body.estado).toBe('CANCELADO');

    // Existencias restauradas (reversión con deltas positivos)
    const restaurado = await stock('DSP-001', ireId);
    expect(restaurado.cantidad).toBe(antes.cantidad);
    expect(restaurado.cantidad_bloqueada).toBe(antes.cantidad_bloqueada + 2); // queda el bloqueo del alistamiento

    const reversion = await t.dataSource.query(
      `SELECT cantidad_delta, cantidad_bloqueada_delta FROM inventory_movements
       WHERE doc_tipo='DESPACHO' AND doc_id=$1 AND cantidad_delta > 0`,
      [dId],
    );
    expect(reversion).toHaveLength(1);
    expect(reversion[0].cantidad_delta).toBe(2);

    // cantidad_despachada vuelve a 0 y el pedido es asociable de nuevo
    const oi = await t.dataSource.query(
      `SELECT cantidad_despachada FROM order_items WHERE order_id=$1`,
      [pedidoC.id],
    );
    expect(oi[0].cantidad_despachada).toBe(0);
    const reuso = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoC.id });
    expect(reuso.status).toBe(201);
  });

  it('RBAC negativo: packing solo Operador; aprobación/transporte solo Generador', async () => {
    const d = (global as any).__dispatch1;

    // Generador no puede crear cajas ni escanear
    const boxGen = await t.http
      .post(`/api/v1/dispatches/${d.id}/boxes`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(boxGen.status).toBe(403);

    // Operador no puede aprobar, aprobar parcial, transporte ni cancelar
    const apOp = await t.http
      .post(`/api/v1/dispatches/${d.id}/aprobar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(apOp.status).toBe(403);
    const trOp = await t.http
      .post(`/api/v1/dispatches/${d.id}/transporte`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'X' });
    expect(trOp.status).toBe(403);
    const cancelOp = await t.http
      .post(`/api/v1/dispatches/${d.id}/cancelar`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    expect(cancelOp.status).toBe(403);

    // Comercial no puede crear despachos
    const comCrear = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ orderId: '00000000-0000-4000-8000-000000000000' });
    expect(comCrear.status).toBe(403);

    // Auditoría: Despachos es una de las 6 entidades auditadas
    const logs = await t.dataSource.query(
      `SELECT DISTINCT accion FROM audit_logs WHERE tabla='Despachos'`,
    );
    const acciones = logs.map((l: any) => l.accion);
    expect(acciones).toContain('DESPACHO_CREADO');
    expect(acciones).toContain('DESPACHO_CAJA_CERRADA');
    expect(acciones).toContain('DESPACHO_TRANSPORTE_REGISTRADO');
    expect(acciones).toContain('DESPACHO_PARCIAL_APROBADO');
    expect(acciones).toContain('DESPACHO_CANCELADO');
  });
});
