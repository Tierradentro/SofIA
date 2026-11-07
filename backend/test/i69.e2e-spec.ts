import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I69 — ajuste post-factura y mejoras de alistamiento:
 *
 * a) Pedido Aprobado/Despachado corregido «en directo» y con la factura
 *    corregida en World Office: el Generador/Administrador revisa la nueva
 *    factura (preview) y aplica el ajuste. El ajuste solo reduce: las
 *    unidades de más retornan al inventario (reingreso) y se retiran de las
 *    cajas del despacho, incluidas las CERRADAS; una caja cerrada que queda
 *    vacía se reabre. La línea que queda en cero se elimina del pedido.
 * b) El ajuste es exclusivo de Generador/Administrador (Operador → 403) y
 *    solo aplica a pedidos Aprobado/Despachado (Abierto → 400).
 * c) Al reportar una novedad y corregir el pedido, las cantidades ya
 *    alistadas se conservan (no se vuelve a empezar de cero).
 */
describe('I69 ajuste por factura corregida y conservación de alistadas (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let clienteId: string;
  let comercialId: string;

  async function crearProducto(codigo: string, cantidad: number) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo,
        descripcion: `Producto ${codigo}`,
        unidadMedida: 'UND',
        precio: 9000,
      });
    expect(res.status).toBe(201);
    if (cantidad > 0) {
      await t.dataSource.query(`UPDATE products SET cantidad=$1 WHERE id=$2`, [
        cantidad,
        res.body.id,
      ]);
    }
    return res.body;
  }

  async function stock(codigo: string) {
    const rows = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE codigo=$1 AND empresa_id=$2`,
      [codigo, ireId],
    );
    return { cantidad: Number(rows[0].cantidad), bloqueada: Number(rows[0].cantidad_bloqueada) };
  }

  /** Factura de venta como documento OCR directo (la extracción OCR ya se
   *  prueba en otros specs; aquí importa el cruce y el ajuste). */
  async function insertarFactura(
    numero: string,
    items: { referencia: string; descripcion: string; cantidad: number; valorUnidad: number }[],
  ): Promise<string> {
    const admin = await t.dataSource.query(`SELECT id FROM users WHERE username='Admin'`);
    const doc = await t.dataSource.query(
      `INSERT INTO documents (owner_type, owner_id, tipo, path, nombre_original, mime, size, es_temporal, created_by)
       VALUES ('ocr', NULL, 'FACTURA_VENTA', $1, $2, 'image/png', 0, true, $3) RETURNING id`,
      [`test/${numero}.png`, `${numero}.png`, admin[0].id],
    );
    const ocr = await t.dataSource.query(
      `INSERT INTO ocr_documents (document_id, tipo_documento, motor, estado, datos_extraidos, empresa_id, created_by)
       VALUES ($1, 'FACTURA_VENTA', 'OCR_LOCAL', 'CONFIRMADO', $2, $3, $4) RETURNING id`,
      [doc[0].id, JSON.stringify({ numeroFactura: numero, items }), ireId, admin[0].id],
    );
    return ocr[0].id as string;
  }

  async function crearPedido(items: { referencia: string; cantidad: number }[]) {
    const res = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, comercialId, items });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function alistar(id: string, lecturas: { codigo: string; cantidad: number }[]) {
    for (const l of lecturas) {
      const scan = await t.http
        .post(`/api/v1/orders/${id}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ modo: 'COMPLETO', codigo: l.codigo, cantidad: l.cantidad });
      expect(scan.status).toBe(201);
    }
  }

  /** Pedido APROBADO con su factura inicial (cantidades idénticas). */
  async function crearPedidoAprobado(
    items: { referencia: string; cantidad: number }[],
    numeroFactura: string,
  ) {
    const pedido = await crearPedido(items);
    await alistar(
      pedido.id,
      items.map((i) => ({ codigo: i.referencia, cantidad: i.cantidad })),
    );
    const fin = await t.http
      .post(`/api/v1/orders/${pedido.id}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    const ocrId = await insertarFactura(
      numeroFactura,
      items.map((i) => ({
        referencia: i.referencia,
        descripcion: `Producto ${i.referencia}`,
        cantidad: i.cantidad,
        valorUnidad: 9000,
      })),
    );
    const aprob = await t.http
      .post(`/api/v1/orders/${pedido.id}/invoice`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrId });
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');
    return aprob.body;
  }

  /** Empaca todo el pedido en una sola caja y la cierra. */
  async function empacarEnUnaCaja(pedidoId: string) {
    const dsp = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedidoId });
    expect(dsp.status).toBe(201);
    // M09 paso 2: aprobar el despacho (CREADO → ABIERTO) para empacar
    const aprob = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(aprob.status).toBe(201);
    const caja = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(caja.status).toBe(201);
    const det = await t.http
      .get(`/api/v1/orders/${pedidoId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    for (const i of det.body.items) {
      const scan = await t.http
        .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja.body.id}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ codigo: i.codigo, cantidad: i.cantidadAlistada });
      expect(scan.status).toBe(201);
    }
    const cierre = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(cierre.status).toBe(201);
    const fin = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/finalizar-empaque`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    return { despachoId: dsp.body.id, cajaId: caja.body.id, cajaRef: caja.body.boxId };
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);

    for (const [username, rol] of [
      ['generador.i69', 'GENERADOR'],
      ['operador.i69', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i69', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i69', 'ClaveInicial1', 'ClaveNueva123');

    const empresas = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente I69', identificacion: '900-I69', ciudad: 'Bogotá' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;

    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial I69', identificacion: 'C-I69' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    await crearProducto('I69-001', 10);
    await crearProducto('I69-002', 8);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('a) ajuste en pedido DESPACHADO: retorno al inventario y caja cerrada afectada', async () => {
    // Pedido 5×I69-001 + 3×I69-002, aprobado con factura FECV-9000
    const pedido = await crearPedidoAprobado(
      [
        { referencia: 'I69-001', cantidad: 5 },
        { referencia: 'I69-002', cantidad: 3 },
      ],
      'FECV-9000',
    );
    // Empacar todo en una caja cerrada y despachar con transporte interno
    const { despachoId, cajaRef } = await empacarEnUnaCaja(pedido.id);
    const transporte = await t.http
      .post(`/api/v1/dispatches/${despachoId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Mensajero interno' });
    expect(transporte.status).toBe(201);
    const despachado = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(despachado.body.estado).toBe('DESPACHADO');
    expect(await stock('I69-001')).toEqual({ cantidad: 5, bloqueada: 0 });
    expect(await stock('I69-002')).toEqual({ cantidad: 5, bloqueada: 0 });

    // La factura corregida en WO: I69-001 baja de 5 a 3; I69-002 se elimina
    const ocrCorregida = await insertarFactura('FECV-9001', [
      { referencia: 'I69-001', descripcion: 'Producto I69-001', cantidad: 3, valorUnidad: 9000 },
    ]);

    // Revisión (preview): no modifica nada
    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrCorregida });
    expect(preview.status).toBe(201);
    expect(preview.body.numeroFactura).toBe('FECV-9001');
    const prev1 = preview.body.items.find((i: any) => i.codigo === 'I69-001');
    const prev2 = preview.body.items.find((i: any) => i.codigo === 'I69-002');
    expect(prev1).toMatchObject({ cantidadDespachada: 5, cantidadFacturada: 3, retornar: 2, excedenteNoAjustable: 0 });
    expect(prev2).toMatchObject({ cantidadDespachada: 3, cantidadFacturada: 0, retornar: 3, excedenteNoAjustable: 0 });
    // El preview no tocó nada
    expect(await stock('I69-001')).toEqual({ cantidad: 5, bloqueada: 0 });

    // La revisión muestra lo que la factura NO puede agregar: un producto
    // nuevo sin cruce y un excedente sobre lo alistado (la factura trae 7
    // pero solo se alistaron 5 — Sofía no alista a posteriori)
    const ocrConExceso = await insertarFactura('FECV-9002', [
      { referencia: 'I69-001', descripcion: 'Producto I69-001', cantidad: 7, valorUnidad: 9000 },
      { referencia: 'I69-999', descripcion: 'Producto nuevo de WO', cantidad: 4, valorUnidad: 5000 },
    ]);
    const prevExceso = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrConExceso });
    expect(prevExceso.status).toBe(201);
    const prevEx1 = prevExceso.body.items.find((i: any) => i.codigo === 'I69-001');
    // Se conservan las 5 alistadas (no retorna nada) y el excedente queda visible
    expect(prevEx1).toMatchObject({ cantidadFacturada: 5, retornar: 0, excedenteNoAjustable: 2 });
    expect(prevExceso.body.sinCruce).toEqual([
      { referencia: 'I69-999', descripcion: 'Producto nuevo de WO', cantidad: 4 },
    ]);

    // Aplicar el ajuste aprobado
    const ajuste = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        ocrDocumentId: ocrCorregida,
        ajustes: [
          { itemId: prev1.itemId, cantidadFacturada: 3 },
          { itemId: prev2.itemId, cantidadFacturada: 0 },
        ],
      });
    expect(ajuste.status).toBe(201);
    expect(ajuste.body.estado).toBe('DESPACHADO'); // conserva su estado
    expect(ajuste.body.numeroFactura).toBe('FECV-9001');
    expect(ajuste.body.items).toHaveLength(1); // I69-002 se eliminó
    expect(ajuste.body.items[0]).toMatchObject({
      codigo: 'I69-001',
      cantidad: 3,
      cantidadAlistada: 3,
      cantidadDespachada: 3,
    });

    // El producto retornó al inventario (2 + 3 unidades)
    expect(await stock('I69-001')).toEqual({ cantidad: 7, bloqueada: 0 });
    expect(await stock('I69-002')).toEqual({ cantidad: 8, bloqueada: 0 });

    // La caja cerrada se afectó: quedan 3 de I69-001 y la fila de I69-002
    // desapareció; como aún tiene ítems, sigue CERRADA
    const boxItems = await t.dataSource.query(
      `SELECT bi.codigo, bi.cantidad, b.estado, b.box_id
         FROM box_items bi JOIN boxes b ON b.id = bi.box_id
        WHERE b.dispatch_id = $1`,
      [despachoId],
    );
    expect(boxItems).toHaveLength(1);
    expect(boxItems[0]).toMatchObject({ codigo: 'I69-001', cantidad: 3, estado: 'CERRADA', box_id: cajaRef });

    // Movimientos de reingreso con trazabilidad al pedido
    const movs = await t.dataSource.query(
      `SELECT tipo, cantidad_delta, cantidad_bloqueada_delta FROM inventory_movements
        WHERE doc_tipo='PEDIDO' AND doc_id=$1 AND tipo='REINGRESO_DEVOLUCION'`,
      [pedido.id],
    );
    expect(movs).toHaveLength(2);
    for (const m of movs) {
      expect(m.cantidad_delta).toBeGreaterThan(0);
      expect(Number(m.cantidad_bloqueada_delta)).toBe(0);
    }

    // Auditoría del ajuste
    const audit = await t.dataSource.query(
      `SELECT valor_nuevo FROM audit_logs
        WHERE tabla='Pedidos' AND registro_id=$1 AND accion='PEDIDO_AJUSTADO_POR_FACTURA'`,
      [pedido.id],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].valor_nuevo.numeroFactura).toBe('FECV-9001');
    expect(audit[0].valor_nuevo.cajasAfectadas).toEqual([
      { caja: cajaRef, retiradas: 5, reabierta: false },
    ]);
  });

  it('b) caja CERRADA que queda vacía por el ajuste se reabre (pedido APROBADO)', async () => {
    const pedido = await crearPedidoAprobado([{ referencia: 'I69-002', cantidad: 2 }], 'FECV-9010');
    const { despachoId, cajaId } = await empacarEnUnaCaja(pedido.id);
    expect(await stock('I69-002')).toEqual({ cantidad: 6, bloqueada: 0 });

    // La factura corregida ya no trae el producto: la línea se elimina
    const ocrCorregida = await insertarFactura('FECV-9011', [
      { referencia: 'I69-001', descripcion: 'Otro producto', cantidad: 1, valorUnidad: 9000 },
    ]);
    // I69: la revisión muestra los productos de la factura que existen en el
    // catálogo pero NO están en el pedido (I69-001) — antes pasaban
    // desapercibidos (caso real: amortiguadores IZQ del FEIR 10349)
    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrCorregida });
    expect(preview.status).toBe(201);
    expect(preview.body.faltantesEnPedido).toEqual([
      { codigo: 'I69-001', descripcion: 'Producto I69-001', cantidad: 1 },
    ]);
    const detalle = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const ajuste = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        ocrDocumentId: ocrCorregida,
        ajustes: [{ itemId: detalle.body.items[0].id, cantidadFacturada: 0 }],
      });
    expect(ajuste.status).toBe(201);
    expect(ajuste.body.estado).toBe('APROBADO');
    expect(ajuste.body.items).toHaveLength(0);
    expect(ajuste.body.numeroFactura).toBe('FECV-9011');

    // Retornó al inventario y la caja vacía se reabrió
    expect(await stock('I69-002')).toEqual({ cantidad: 8, bloqueada: 0 });
    const caja = await t.dataSource.query(
      `SELECT estado, cerrada_at FROM boxes WHERE id=$1`,
      [cajaId],
    );
    expect(caja[0].estado).toBe('ABIERTA');
    expect(caja[0].cerrada_at).toBeNull();
  });

  it('c) el ajuste es de Generador/Administrador y solo en Aprobado/Despachado', async () => {
    const pedido = await crearPedido([{ referencia: 'I69-001', cantidad: 1 }]);
    const ocr = await insertarFactura('FECV-9020', [
      { referencia: 'I69-001', descripcion: 'Producto I69-001', cantidad: 1, valorUnidad: 9000 },
    ]);

    // Operador no puede ni revisar ni aplicar
    const prevOp = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ocrDocumentId: ocr });
    expect(prevOp.status).toBe(403);
    const aplOp = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ocrDocumentId: ocr, ajustes: [{ itemId: pedido.id, cantidadFacturada: 0 }] });
    expect(aplOp.status).toBe(403);

    // Pedido Abierto no es ajustable
    const prevAbierto = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocr });
    expect(prevAbierto.status).toBe(400);
    expect(prevAbierto.body.message).toContain('Aprobado o Despachado');
  });

  it('d) novedad + corrección conserva las cantidades ya alistadas', async () => {
    const pedido = await crearPedido([{ referencia: 'I69-001', cantidad: 4 }]);
    // El operador alista 3 de 4 y reporta novedad
    await alistar(pedido.id, [{ codigo: 'I69-001', cantidad: 3 }]);
    const reporte = await t.http
      .post(`/api/v1/orders/${pedido.id}/reportar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(reporte.status).toBe(201);
    expect(reporte.body.estado).toBe('PENDIENTE_CORRECCION');

    // El generador corrige subiendo la cantidad a 5: las 3 alistadas se
    // conservan (no vuelve a empezar de cero)
    const correccion = await t.http
      .patch(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ items: [{ referencia: 'I69-001', cantidad: 5 }] });
    expect(correccion.status).toBe(200);
    expect(correccion.body.estado).toBe('ABIERTO');
    expect(correccion.body.items[0].cantidad).toBe(5);
    expect(correccion.body.items[0].cantidadAlistada).toBe(3);

    // La auditoría registra lo alistado que se conservó
    const audit = await t.dataSource.query(
      `SELECT valor_nuevo FROM audit_logs
        WHERE tabla='Pedidos' AND registro_id=$1 AND accion='PEDIDO_CORREGIDO'`,
      [pedido.id],
    );
    expect(audit[0].valor_nuevo.items[0]).toMatchObject({
      codigo: 'I69-001',
      cantidad: 5,
      cantidadAlistada: 3,
    });

    // Si la corrección baja por debajo de lo alistado, se recorta (tapa) y
    // se libera solo el excedente
    const reporte2 = await t.http
      .post(`/api/v1/orders/${pedido.id}/reportar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(reporte2.status).toBe(201);
    const correccion2 = await t.http
      .patch(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ items: [{ referencia: 'I69-001', cantidad: 2 }] });
    expect(correccion2.status).toBe(200);
    expect(correccion2.body.items[0].cantidadAlistada).toBe(2);
  });
});
