import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I69/I70 — ajuste post-factura y mejoras de alistamiento:
 *
 * a) Pedido Aprobado/Despachado corregido «en directo» y con la factura
 *    corregida en World Office (MISMO número): el Generador/Administrador
 *    revisa la nueva factura (preview) y aplica el ajuste. Las unidades de
 *    más retornan al inventario (reingreso) y se retiran de las cajas del
 *    despacho, incluidas las CERRADAS; una caja cerrada que queda vacía se
 *    reabre. La línea que queda en cero se elimina del pedido.
 * b) Caja CERRADA que queda vacía por el ajuste se reabre (pedido APROBADO)
 *    y la revisión muestra los productos de la factura que no están en el
 *    pedido (nuevosEnFactura).
 * c) El ajuste es exclusivo de Generador/Administrador (Operador → 403) y
 *    solo aplica a pedidos Aprobado/Despachado (Abierto → 400).
 * d) Al reportar una novedad y corregir el pedido, las cantidades ya
 *    alistadas se conservan (no se vuelve a empezar de cero).
 * e) I70 — Aumento en pedido APROBADO: las unidades de más salen del
 *    inventario y quedan bloqueadas en la bahía de empaque.
 * f) I70 — Aumento y producto NUEVO en pedido DESPACHADO: entran a la
 *    ÚLTIMA caja creada del despacho y salen del inventario.
 * g) I70 — La nueva factura debe tener el mismo número que la del pedido.
 * h) I70 — Una entrada sin existencias disponibles se rechaza (400).
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
      [
        doc[0].id,
        // Mismo formato que produce el parser OCR real (valorUnitario)
        JSON.stringify({
          numeroFactura: numero,
          items: items.map((i) => ({
            referencia: i.referencia,
            descripcion: i.descripcion,
            cantidad: i.cantidad,
            valorUnitario: i.valorUnidad,
          })),
        }),
        ireId,
        admin[0].id,
      ],
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

    // La factura corregida en WO (MISMO número): I69-001 baja de 5 a 3;
    // I69-002 se elimina
    const ocrCorregida = await insertarFactura('FECV-9000', [
      { referencia: 'I69-001', descripcion: 'Producto I69-001', cantidad: 3, valorUnidad: 9000 },
    ]);

    // Revisión (preview): no modifica nada
    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrCorregida });
    expect(preview.status).toBe(201);
    expect(preview.body.numeroFactura).toBe('FECV-9000');
    const prev1 = preview.body.items.find((i: any) => i.codigo === 'I69-001');
    const prev2 = preview.body.items.find((i: any) => i.codigo === 'I69-002');
    expect(prev1).toMatchObject({ cantidadDespachada: 5, cantidadFacturada: 3, retornar: 2, agregar: 0 });
    expect(prev2).toMatchObject({ cantidadDespachada: 3, cantidadFacturada: 0, retornar: 3, agregar: 0 });
    // El preview no tocó nada
    expect(await stock('I69-001')).toEqual({ cantidad: 5, bloqueada: 0 });

    // La revisión muestra las ENTRADAS: un excedente sobre lo alistado (la
    // factura trae 7 y se alistaron 5 → agregar 2, con el stock disponible)
    // y un producto sin cruce en el catálogo (no se puede ingresar)
    const ocrConExceso = await insertarFactura('FECV-9000', [
      { referencia: 'I69-001', descripcion: 'Producto I69-001', cantidad: 7, valorUnidad: 9000 },
      { referencia: 'I69-999', descripcion: 'Producto nuevo de WO', cantidad: 4, valorUnidad: 5000 },
    ]);
    const prevExceso = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrConExceso });
    expect(prevExceso.status).toBe(201);
    const prevEx1 = prevExceso.body.items.find((i: any) => i.codigo === 'I69-001');
    expect(prevEx1).toMatchObject({ cantidadFacturada: 7, retornar: 0, agregar: 2, stockDisponible: 5 });
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
    expect(ajuste.body.numeroFactura).toBe('FECV-9000');
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
    expect(audit[0].valor_nuevo.numeroFactura).toBe('FECV-9000');
    expect(audit[0].valor_nuevo.cajasAfectadas).toEqual([
      { caja: cajaRef, retiradas: 5, agregadas: 0, reabierta: false },
    ]);
  });

  it('b) caja CERRADA que queda vacía por el ajuste se reabre (pedido APROBADO)', async () => {
    const pedido = await crearPedidoAprobado([{ referencia: 'I69-002', cantidad: 2 }], 'FECV-9010');
    const { despachoId, cajaId } = await empacarEnUnaCaja(pedido.id);
    expect(await stock('I69-002')).toEqual({ cantidad: 6, bloqueada: 0 });

    // La factura corregida (mismo número) ya no trae el producto: la línea
    // se elimina; y trae uno nuevo (I69-001) que aparece en nuevosEnFactura
    const ocrCorregida = await insertarFactura('FECV-9010', [
      { referencia: 'I69-001', descripcion: 'Otro producto', cantidad: 1, valorUnidad: 9000 },
    ]);
    // I69/I70: la revisión muestra los productos de la factura que existen
    // en el catálogo pero NO están en el pedido (I69-001) — antes pasaban
    // desapercibidos (caso real: amortiguadores IZQ del FEIR 10349); ahora
    // se pueden ingresar con el ajuste
    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrCorregida });
    expect(preview.status).toBe(201);
    expect(preview.body.nuevosEnFactura).toHaveLength(1);
    expect(preview.body.nuevosEnFactura[0]).toMatchObject({
      codigo: 'I69-001',
      descripcion: 'Producto I69-001',
      cantidad: 1,
    });
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
    expect(ajuste.body.numeroFactura).toBe('FECV-9010');

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

  it('e) I70: aumento en pedido APROBADO — las unidades entran del inventario a la bahía', async () => {
    await crearProducto('I69-010', 10);
    const pedido = await crearPedidoAprobado([{ referencia: 'I69-010', cantidad: 4 }], 'FECV-9020');
    expect(await stock('I69-010')).toEqual({ cantidad: 10, bloqueada: 4 });

    // La factura corregida (mismo número) sube de 4 a 7
    const ocrCorregida = await insertarFactura('FECV-9020', [
      { referencia: 'I69-010', descripcion: 'Producto I69-010', cantidad: 7, valorUnidad: 9000 },
    ]);
    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrCorregida });
    expect(preview.status).toBe(201);
    const prev = preview.body.items.find((i: any) => i.codigo === 'I69-010');
    expect(prev).toMatchObject({
      cantidadAlistada: 4,
      cantidadFacturada: 7,
      retornar: 0,
      agregar: 3,
      stockDisponible: 6,
    });

    const ajuste = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        ocrDocumentId: ocrCorregida,
        ajustes: [{ itemId: prev.itemId, cantidadFacturada: 7 }],
      });
    expect(ajuste.status).toBe(201);
    expect(ajuste.body.estado).toBe('APROBADO');
    expect(ajuste.body.items[0]).toMatchObject({
      codigo: 'I69-010',
      cantidad: 7,
      cantidadAlistada: 7,
      cantidadDespachada: 0,
    });

    // Entrada de inventario: las 3 unidades quedaron bloqueadas en la bahía
    expect(await stock('I69-010')).toEqual({ cantidad: 10, bloqueada: 7 });
    const movs = await t.dataSource.query(
      `SELECT cantidad_delta, cantidad_bloqueada_delta FROM inventory_movements
        WHERE doc_tipo='PEDIDO' AND doc_id=$1 AND tipo='BLOQUEO_ALISTAMIENTO' ORDER BY id`,
      [pedido.id],
    );
    const entrada = movs[movs.length - 1];
    expect(Number(entrada.cantidad_delta)).toBe(0);
    expect(Number(entrada.cantidad_bloqueada_delta)).toBe(3);
    const bahia = await t.dataSource.query(
      `SELECT COALESCE(SUM(l.cantidad), 0)::text AS total
         FROM warehouse_product_locations l
         JOIN warehouse_areas a ON a.id = l.area_id
         JOIN products p ON p.id = l.product_id
        WHERE p.codigo = 'I69-010' AND a.tipo = 'BAHIA_EMPAQUE'`,
    );
    expect(Number(bahia[0].total)).toBe(7);
  });

  it('f) I70: aumento y producto nuevo en DESPACHADO entran a la ÚLTIMA caja creada', async () => {
    await crearProducto('I69-011', 10);
    await crearProducto('I69-012', 5);
    const pedido = await crearPedidoAprobado([{ referencia: 'I69-011', cantidad: 4 }], 'FECV-9030');

    // Despacho con DOS cajas cerradas (2 + 2) y transporte registrado
    const dsp = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedido.id });
    expect(dsp.status).toBe(201);
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const caja1 = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'I69-011', cantidad: 2 });
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja1.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const caja2 = await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja2.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'I69-011', cantidad: 2 });
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/boxes/${caja2.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/finalizar-empaque`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dsp.body.id}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Mensajero interno' });
    const despachado = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(despachado.body.estado).toBe('DESPACHADO');
    expect(await stock('I69-011')).toEqual({ cantidad: 6, bloqueada: 0 });

    // Factura corregida (mismo número): I69-011 sube a 6 y entra I69-012 ×2
    const ocrCorregida = await insertarFactura('FECV-9030', [
      { referencia: 'I69-011', descripcion: 'Producto I69-011', cantidad: 6, valorUnidad: 9000 },
      { referencia: 'I69-012', descripcion: 'Producto I69-012', cantidad: 2, valorUnidad: 7000 },
    ]);
    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrCorregida });
    expect(preview.status).toBe(201);
    const prev11 = preview.body.items.find((i: any) => i.codigo === 'I69-011');
    expect(prev11).toMatchObject({ cantidadDespachada: 4, cantidadFacturada: 6, retornar: 0, agregar: 2 });
    expect(preview.body.nuevosEnFactura).toHaveLength(1);
    const nuevo12 = preview.body.nuevosEnFactura[0];
    expect(nuevo12).toMatchObject({ codigo: 'I69-012', cantidad: 2, valorUnitario: 7000, stockDisponible: 5 });

    const ajuste = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        ocrDocumentId: ocrCorregida,
        ajustes: [
          { itemId: prev11.itemId, cantidadFacturada: 6 },
          { productId: nuevo12.productId, cantidadFacturada: 2 },
        ],
      });
    expect(ajuste.status).toBe(201);
    expect(ajuste.body.estado).toBe('DESPACHADO');
    const it11 = ajuste.body.items.find((i: any) => i.codigo === 'I69-011');
    const it12 = ajuste.body.items.find((i: any) => i.codigo === 'I69-012');
    expect(it11).toMatchObject({ cantidad: 6, cantidadAlistada: 6, cantidadDespachada: 6 });
    expect(it12).toMatchObject({ cantidad: 2, cantidadAlistada: 2, cantidadDespachada: 2 });
    // El valor unitario del producto nuevo es el de la factura
    expect(Number(it12.valorUnidad)).toBe(7000);

    // Salidas de inventario: 2 + 2 unidades
    expect(await stock('I69-011')).toEqual({ cantidad: 4, bloqueada: 0 });
    expect(await stock('I69-012')).toEqual({ cantidad: 3, bloqueada: 0 });

    // TODO entró a la ÚLTIMA caja creada (caja2); la caja1 quedó intacta
    const filas = await t.dataSource.query(
      `SELECT b.box_id, bi.codigo, bi.cantidad
         FROM box_items bi JOIN boxes b ON b.id = bi.box_id
        WHERE b.dispatch_id = $1
        ORDER BY b.numero_en_despacho, bi.codigo`,
      [dsp.body.id],
    );
    expect(filas).toEqual([
      { box_id: caja1.body.boxId, codigo: 'I69-011', cantidad: 2 },
      { box_id: caja2.body.boxId, codigo: 'I69-011', cantidad: 4 },
      { box_id: caja2.body.boxId, codigo: 'I69-012', cantidad: 2 },
    ]);

    // Las salidas quedaron trazadas como cierre de caja del despacho
    const movs = await t.dataSource.query(
      `SELECT p.codigo, SUM(m.cantidad_delta)::text AS salidas
         FROM inventory_movements m JOIN products p ON p.id = m.product_id
        WHERE m.doc_tipo = 'DESPACHO' AND m.doc_id = $1 AND m.tipo = 'DESPACHO_CIERRE_CAJA'
        GROUP BY p.codigo`,
      [dsp.body.id],
    );
    expect(Object.fromEntries(movs.map((r: any) => [r.codigo, Number(r.salidas)]))).toEqual({
      'I69-011': -6,
      'I69-012': -2,
    });

    // Auditoría: nuevos y caja afectada con las agregadas
    const audit = await t.dataSource.query(
      `SELECT valor_nuevo FROM audit_logs
        WHERE tabla='Pedidos' AND registro_id=$1 AND accion='PEDIDO_AJUSTADO_POR_FACTURA'`,
      [pedido.id],
    );
    expect(audit[0].valor_nuevo.nuevos).toEqual([{ codigo: 'I69-012', cantidad: 2 }]);
    expect(audit[0].valor_nuevo.cajasAfectadas).toEqual([
      { caja: caja2.body.boxId, retiradas: 0, agregadas: 4, reabierta: false },
    ]);
  });

  it('g) I70: la nueva factura debe tener el MISMO número de la factura del pedido', async () => {
    const pedido = await crearPedidoAprobado([{ referencia: 'I69-001', cantidad: 1 }], 'FECV-9040');
    const ocrOtroNumero = await insertarFactura('FECV-9999', [
      { referencia: 'I69-001', descripcion: 'Producto I69-001', cantidad: 1, valorUnidad: 9000 },
    ]);

    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrOtroNumero });
    expect(preview.status).toBe(400);
    expect(preview.body.message).toContain('no coincide');

    const det = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const ajuste = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        ocrDocumentId: ocrOtroNumero,
        ajustes: [{ itemId: det.body.items[0].id, cantidadFacturada: 1 }],
      });
    expect(ajuste.status).toBe(400);
    expect(ajuste.body.message).toContain('no coincide');

    // Nada cambió
    const despues = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(despues.body.items[0].cantidad).toBe(1);
  });

  it('h) I70: una entrada sin existencias disponibles se rechaza sin tocar nada', async () => {
    await crearProducto('I69-013', 6);
    const pedido = await crearPedidoAprobado([{ referencia: 'I69-013', cantidad: 5 }], 'FECV-9050');
    expect(await stock('I69-013')).toEqual({ cantidad: 6, bloqueada: 5 });

    // La factura corregida sube a 8 pero solo hay 1 disponible (6 − 5)
    const ocrCorregida = await insertarFactura('FECV-9050', [
      { referencia: 'I69-013', descripcion: 'Producto I69-013', cantidad: 8, valorUnidad: 9000 },
    ]);
    const preview = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura/preview`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrCorregida });
    expect(preview.status).toBe(201);
    const prev = preview.body.items.find((i: any) => i.codigo === 'I69-013');
    expect(prev).toMatchObject({ agregar: 3, stockDisponible: 1 });

    const ajuste = await t.http
      .post(`/api/v1/orders/${pedido.id}/ajuste-factura`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        ocrDocumentId: ocrCorregida,
        ajustes: [{ itemId: prev.itemId, cantidadFacturada: 8 }],
      });
    expect(ajuste.status).toBe(400);
    expect(ajuste.body.message).toContain('Existencias insuficientes');

    // Nada cambió
    expect(await stock('I69-013')).toEqual({ cantidad: 6, bloqueada: 5 });
    const det = await t.http
      .get(`/api/v1/orders/${pedido.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(det.body.items[0].cantidad).toBe(5);
  });
});
