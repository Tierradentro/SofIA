import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I13 — Regresiones de concurrencia e integridad (hallazgos QA):
 * C-1: dos cierres concurrentes de la misma caja → exactamente uno tiene éxito
 *      y el stock se descuenta una sola vez.
 * H-6: dos escaneos concurrentes de la misma línea → ambos incrementos se
 *      conservan (sin bloqueo huérfano); el excedente se rechaza atómicamente.
 * C-2: cancelación de un pedido parcialmente despachado libera solo
 *      alistada − despachada; whitelist de estados (B-2).
 */
describe('Concurrencia e integridad I13 (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let clienteId: string;
  let comercialId: string;

  async function crearProducto(codigo: string, cantidad: number, barcode?: string) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo,
        descripcion: `Producto ${codigo}`,
        unidadMedida: 'UND',
        precio: 5000,
      });
    expect(res.status).toBe(201);
    if (cantidad > 0) {
      await t.dataSource.query(`UPDATE products SET cantidad=$1 WHERE id=$2`, [
        cantidad,
        res.body.id,
      ]);
    }
    if (barcode) {
      const b = await t.http
        .post(`/api/v1/products/${res.body.id}/barcode`)
        .set('Authorization', `Bearer ${generadorToken}`)
        .send({ barcode, origen: 'MANUAL' });
      expect(b.status).toBe(201);
    }
    return res.body;
  }

  async function crearPedidoAprobado(
    items: { referencia: string; cantidad: number; scanCode: string }[],
  ) {
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        clienteId,
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
    await t.http
      .post(`/api/v1/orders/${id}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.dataSource.query(
      `UPDATE orders SET estado='APROBADO', aprobado_at=now() WHERE id=$1`,
      [id],
    );
    return id;
  }

  async function stock(codigo: string) {
    const rows = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE codigo=$1`,
      [codigo],
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

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente Concurrencia', identificacion: '900777111', ciudad: 'Bogotá', direccion: 'Av 1' });
    clienteId = cli.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Concurrencia', identificacion: 'C-I13' });
    comercialId = com.body.id;

    for (const [username, rol] of [
      ['generador.i13', 'GENERADOR'],
      ['operador.i13', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i13', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i13', 'ClaveInicial1', 'ClaveNueva123');

    await crearProducto('CONC-001', 50, '7513001');
    await crearProducto('CONC-002', 30, '7513002');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('C-1: dos cierres concurrentes de la misma caja → exactamente uno tiene éxito', async () => {
    const pedidoId = await crearPedidoAprobado([
      { referencia: 'CONC-001', cantidad: 5, scanCode: '7513001' },
    ]);
    const dsp = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoId });
    expect(dsp.status).toBe(201);
    const dspId = dsp.body.id;

    const aprobar = await t.http
      .post(`/api/v1/dispatches/${dspId}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(aprobar.status).toBe(201);

    const caja = await t.http
      .post(`/api/v1/dispatches/${dspId}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    expect(caja.status).toBe(201);

    const scan = await t.http
      .post(`/api/v1/dispatches/${dspId}/boxes/${caja.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7513001', cantidad: 5 });
    expect(scan.status).toBe(201);

    const antes = await stock('CONC-001');
    expect(Number(antes.cantidad)).toBe(50);
    expect(Number(antes.cantidad_bloqueada)).toBe(5);

    // Dos cierres simultáneos de la misma caja
    const [r1, r2] = await Promise.all([
      t.http
        .post(`/api/v1/dispatches/${dspId}/boxes/${caja.body.id}/cerrar`)
        .set('Authorization', `Bearer ${operadorToken}`),
      t.http
        .post(`/api/v1/dispatches/${dspId}/boxes/${caja.body.id}/cerrar`)
        .set('Authorization', `Bearer ${operadorToken}`),
    ]);
    const exitosos = [r1, r2].filter((r) => r.status === 201).length;
    expect(exitosos).toBe(1);
    // Y un reintento posterior (ya cerrada) también se rechaza
    const r3 = await t.http
      .post(`/api/v1/dispatches/${dspId}/boxes/${caja.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect([400, 409]).toContain(r3.status);

    // El stock se descontó exactamente una vez
    const despues = await stock('CONC-001');
    expect(Number(despues.cantidad)).toBe(45);
    expect(Number(despues.cantidad_bloqueada)).toBe(0);

    // cantidad_despachada también una sola vez
    const oi = await t.dataSource.query(
      `SELECT cantidad_despachada FROM order_items WHERE order_id=$1`,
      [pedidoId],
    );
    expect(Number(oi[0].cantidad_despachada)).toBe(5);

    // Solo un movimiento de cierre en el libro mayor
    const movs = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE tipo='DESPACHO_CIERRE_CAJA' AND doc_id=$1`,
      [dspId],
    );
    expect(movs[0].n).toBe(1);
  });

  it('H-6: escaneos concurrentes conservan ambos incrementos; excedente atómico', async () => {
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        clienteId,
        comercialId,
        items: [{ referencia: 'CONC-002', cantidad: 4 }],
      });
    expect(pedido.status).toBe(201);
    const id = pedido.body.id;

    // Dos escaneos simultáneos de 2 unidades cada uno (cabe exactamente)
    const [s1, s2] = await Promise.all([
      t.http
        .post(`/api/v1/orders/${id}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ modo: 'COMPLETO', codigo: '7513002', cantidad: 2 }),
      t.http
        .post(`/api/v1/orders/${id}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ modo: 'COMPLETO', codigo: '7513002', cantidad: 2 }),
    ]);
    const okScans = [s1, s2].filter((s) => s.status === 201).length;
    expect(okScans).toBe(2);

    const det = await t.http
      .get(`/api/v1/orders/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(det.body.items[0].cantidadAlistada).toBe(4);
    const st = await stock('CONC-002');
    expect(Number(st.cantidad_bloqueada)).toBe(4);

    // Línea llena (4/4): el excedente se rechaza atómicamente a nivel de BD,
    // sin dejar bloqueo huérfano
    const x1 = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7513002', cantidad: 1 });
    expect(x1.status).toBe(400);
    const det2 = await t.http
      .get(`/api/v1/orders/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(det2.body.items[0].cantidadAlistada).toBe(4);
    const st2 = await stock('CONC-002');
    expect(Number(st2.cantidad_bloqueada)).toBe(4);
  });

  it('C-2: cancelar pedido parcialmente despachado libera solo lo no despachado', async () => {
    const antes = await stock('CONC-001');
    const pedidoId = await crearPedidoAprobado([
      { referencia: 'CONC-001', cantidad: 10, scanCode: '7513001' },
    ]);
    // Despacho parcial: 4 de 10 unidades empacadas y despachadas
    const dsp = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoId });
    expect(dsp.status).toBe(201);
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const caja = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7513001', cantidad: 4 });
    const cierre = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(cierre.status).toBe(201);

    // Tras el cierre: bloqueada = 10 − 4 = 6
    const intermedio = await stock('CONC-001');
    expect(Number(intermedio.cantidad_bloqueada)).toBe(6);

    // B-2: APROBADO no está en la whitelist de cancelación
    const cancelEnAprobado = await t.http
      .post(`/api/v1/orders/${pedidoId}/cancel`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Cliente canceló parcialmente' });
    expect(cancelEnAprobado.status).toBe(400);

    // Forzamos el estado a ALISTADO (whitelist) para probar la matemática
    await t.dataSource.query(`UPDATE orders SET estado='ALISTADO' WHERE id=$1`, [pedidoId]);
    const cancel = await t.http
      .post(`/api/v1/orders/${pedidoId}/cancel`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Cliente canceló parcialmente' });
    expect(cancel.status).toBe(201);

    // Solo se liberaron las 6 unidades NO despachadas; las 4 despachadas
    // ya habían salido del bloqueo en el cierre de caja
    const final = await stock('CONC-001');
    expect(Number(final.cantidad_bloqueada)).toBe(0);
    expect(Number(final.cantidad)).toBe(Number(antes.cantidad) - 4); // solo las 4 despachadas en este test

    // Movimientos: la liberación fue de 6, no de 10
    const lib = await t.dataSource.query(
      `SELECT cantidad_bloqueada_delta FROM inventory_movements
       WHERE tipo='LIBERACION_BLOQUEO' AND doc_id=$1`,
      [pedidoId],
    );
    expect(Number(lib[0].cantidad_bloqueada_delta)).toBe(-6);

    const det = await t.http
      .get(`/api/v1/orders/${pedidoId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(det.body.estado).toBe('CANCELADO');
    // lo alistado queda reducido a lo efectivamente despachado (4): registro histórico
    expect(det.body.items[0].cantidadAlistada).toBe(4);
    expect(det.body.items[0].cantidadDespachada).toBe(4);
  });
});
