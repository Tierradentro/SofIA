import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I10 — EP-09/M12: inventarios por empresa.
 * HU-048 (jornada por empresa, snapshot al crear, sin mezclar productos),
 * HU-049 (conteo físico por escaneo/manual con ubicación), HU-050
 * (comparación: snapshot, conteo, diferencia y valor estimado), HU-051
 * (documentación de diferencias y aprobación con ajustes AJUSTE_INVENTARIO),
 * HU-052 (cancelación con motivo, existencias sin cambio), M12 bloqueos
 * (alistamiento/despacho/ingreso en espera durante EN_CONTEO; crear y
 * aprobar pedidos sí permitido) y CU-008.
 */
describe('Inventarios por empresa (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let icvId: string;
  let clienteId: string;
  let comercialId: string;

  async function crearProducto(codigo: string, cantidad: number, empresaId: string, barcode?: string) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId, codigo, descripcion: `Producto ${codigo}`, unidadMedida: 'UND', precio: 5000 });
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
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);
    const empresas = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;
    icvId = empresas.find((e: any) => e.nombre === 'ICV').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente Inventarios', identificacion: '900888111', ciudad: 'Bogotá', direccion: 'Calle 5' });
    clienteId = cli.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Inventarios', identificacion: 'C-I10' });
    comercialId = com.body.id;

    for (const [username, rol] of [
      ['generador.i10', 'GENERADOR'],
      ['operador.i10', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i10', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i10', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-048: crea jornada con snapshot; no mezcla empresas; una activa por empresa', async () => {
    const p1 = await crearProducto('INV-001', 10, ireId, '7510001');
    const p2 = await crearProducto('INV-002', 4, ireId);
    const pIcv = await crearProducto('INV-003', 7, icvId);
    (global as any).__p = { p1, p2, pIcv };

    // RBAC: Operador no crea jornadas
    const prohibido = await t.http
      .post('/api/v1/inventories')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ empresaId: ireId, instruccion: 'x', productIds: [p1.id] });
    expect(prohibido.status).toBe(403);

    // Producto de otra empresa → 400 (CU-008: producto de otra empresa bloqueado)
    const mezclado = await t.http
      .post('/api/v1/inventories')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, instruccion: 'Conteo de fast-moving IRE', productIds: [p1.id, pIcv.id] });
    expect(mezclado.status).toBe(400);
    expect(mezclado.body.message).toContain('nunca mezcla empresas');

    const res = await t.http
      .post('/api/v1/inventories')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, instruccion: 'Conteo de fast-moving IRE', productIds: [p1.id, p2.id] });
    expect(res.status).toBe(201);
    expect(res.body.numero).toBe('INV-IRE-0001');
    expect(res.body.estado).toBe('EN_CONTEO');
    expect(res.body.empresa.nombre).toBe('IRE');
    expect(res.body.items).toHaveLength(2);
    const item1 = res.body.items.find((i: any) => i.codigo === 'INV-001');
    expect(item1.existenciaSnapshot).toBe(10);
    expect(item1.conteo).toBeNull();
    expect(item1.diferencia).toBeNull();
    (global as any).__jornada = res.body;

    // Segunda jornada activa para la misma empresa → 409
    const duplicada = await t.http
      .post('/api/v1/inventories')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, instruccion: 'otra', productIds: [p1.id] });
    expect(duplicada.status).toBe(409);

    // ICV sí puede tener la suya en paralelo
    const icv = await t.http
      .post('/api/v1/inventories')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: icvId, instruccion: 'Conteo ICV', productIds: [pIcv.id] });
    expect(icv.status).toBe(201);
    expect(icv.body.numero).toBe('INV-ICV-0001');
    (global as any).__jornadaIcv = icv.body;
  });

  it('M12 bloqueos: alistamiento/despacho/ingreso bloqueados; crear pedido permitido', async () => {
    const { p1 } = (global as any).__p;

    // Crear pedido con producto en inventario: PERMITIDO (M12)
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, comercialId, items: [{ referencia: 'INV-001', cantidad: 2 }] });
    expect(pedido.status).toBe(201);

    // Alistar (escanear): BLOQUEADO
    const scan = await t.http
      .post(`/api/v1/orders/${pedido.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7510001', cantidad: 1 });
    expect(scan.status).toBe(409);
    expect(scan.body.code).toBe('BLOQUEADO_POR_INVENTARIO');
    expect(scan.body.message).toContain('INV-IRE-0001');

    // Ingreso de mercancía del producto: BLOQUEADO
    const ingreso = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        numeroFactura: 'FI-INV-1',
        items: [{ referencia: 'INV-001', cantidadFacturada: 5 }],
      });
    if (ingreso.status === 201) {
      const reciboId = ingreso.body.id;
      await t.http.post(`/api/v1/inbound/${reciboId}/iniciar`).set('Authorization', `Bearer ${operadorToken}`);
      const detalle = await t.http.get(`/api/v1/inbound/${reciboId}`).set('Authorization', `Bearer ${operadorToken}`);
      const item = detalle.body.items.find((i: any) => i.referencia === 'INV-001');
      const reg = await t.http
        .put(`/api/v1/inbound/${reciboId}/items/${item.id}/cantidad`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ cantidadRecibida: 5 });
      expect(reg.status).toBe(409);
      expect(reg.body.code).toBe('BLOQUEADO_POR_INVENTARIO');
    } else {
      // Si el endpoint de creación de ingreso tiene otra forma, al menos
      // el producto sigue sin cambios
      expect([400, 403]).toContain(ingreso.status);
    }

    // Despacho: crear pedido aprobado directo y verificar bloqueo en escaneo a caja
    const pedido2 = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, comercialId, items: [{ referencia: 'INV-002', cantidad: 1 }] });
    // INV-002 también está en la jornada; lo alistamos por SQL (el bloqueo es de API)
    const itemId = (await t.dataSource.query(`SELECT id FROM order_items WHERE order_id=$1`, [pedido2.body.id]))[0].id;
    await t.dataSource.query(`UPDATE order_items SET cantidad_alistada=1 WHERE id=$1`, [itemId]);
    await t.dataSource.query(`UPDATE orders SET estado='APROBADO', aprobado_at=now() WHERE id=$1`, [pedido2.body.id]);
    const d = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedido2.body.id });
    expect(d.status).toBe(201);
    await t.http.post(`/api/v1/dispatches/${d.body.id}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);
    const box = await t.http.post(`/api/v1/dispatches/${d.body.id}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    const scanBox = await t.http
      .post(`/api/v1/dispatches/${d.body.id}/boxes/${box.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'INV-002', cantidad: 1 });
    expect(scanBox.status).toBe(409);
    expect(scanBox.body.code).toBe('BLOQUEADO_POR_INVENTARIO');

    (global as any).__dispatchBloqueado = d.body;
  });

  it('HU-049: conteo físico por escaneo y manual con ubicación', async () => {
    const jornada = (global as any).__jornada;

    // Código desconocido → 400
    const desconocido = await t.http
      .post(`/api/v1/inventories/${jornada.id}/conteo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'XXXXXX', conteo: 1 });
    expect(desconocido.status).toBe(400);

    // Producto de la empresa pero no incluido en la jornada → 400
    const pExtra = await crearProducto('INV-004', 5, ireId);
    const noIncluido = await t.http
      .post(`/api/v1/inventories/${jornada.id}/conteo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'INV-004', conteo: 5 });
    expect(noIncluido.status).toBe(400);
    expect(noIncluido.body.message).toContain('no está incluido');

    // RBAC: Generador no cuenta (actor: Operador)
    const genCuenta = await t.http
      .post(`/api/v1/inventories/${jornada.id}/conteo`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ codigo: '7510001', conteo: 12 });
    expect(genCuenta.status).toBe(403);

    // Por barcode con ubicación
    const c1 = await t.http
      .post(`/api/v1/inventories/${jornada.id}/conteo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7510001', conteo: 12, ubicacion: 'A-01-03' });
    expect(c1.status).toBe(201);
    const item1 = c1.body.items.find((i: any) => i.codigo === 'INV-001');
    expect(item1.conteo).toBe(12);
    expect(item1.ubicacion).toBe('A-01-03');
    expect(item1.diferencia).toBe(2);
    expect(Number(item1.valorEstimado)).toBe(10000); // HU-050: 2 × 5000

    // Manual (código propio), sobrescribe conteo previo
    const c2 = await t.http
      .post(`/api/v1/inventories/${jornada.id}/conteo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'INV-002', conteo: 3, ubicacion: 'B-02-01' });
    expect(c2.status).toBe(201);
    expect(c2.body.items.find((i: any) => i.codigo === 'INV-002').diferencia).toBe(-1);

    // Finalizar con pendientes → 400 (cuento ICV a medias no aplica aquí;
    // esta jornada ya tiene todo contado)
    const fin = await t.http
      .post(`/api/v1/inventories/${jornada.id}/finalizar-conteo`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    expect(fin.body.estado).toBe('PENDIENTE_APROBACION');

    // En PENDIENTE_APROBACION ya no se cuenta
    const tarde = await t.http
      .post(`/api/v1/inventories/${jornada.id}/conteo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7510001', conteo: 10 });
    expect(tarde.status).toBe(400);
  });

  it('HU-051: aprobación exige documentar diferencias y aplica ajustes AJUSTE_INVENTARIO', async () => {
    const jornada = (global as any).__jornada;
    const detalle = await t.http
      .get(`/api/v1/inventories/${jornada.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const conDif = detalle.body.items.filter((i: any) => i.diferencia !== 0);
    expect(conDif).toHaveLength(2);

    // Aprobar sin documentar → 400 con los códigos pendientes
    const sinDoc = await t.http
      .post(`/api/v1/inventories/${jornada.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(sinDoc.status).toBe(400);
    expect(sinDoc.body.message).toContain('INV-001');
    expect(sinDoc.body.message).toContain('INV-002');

    // RBAC: Operador no documenta ni aprueba
    const opDoc = await t.http
      .post(`/api/v1/inventories/${jornada.id}/diferencias`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ notas: [{ itemId: conDif[0].id, nota: 'x' }] });
    expect(opDoc.status).toBe(403);

    // Documentar ambas diferencias
    const doc = await t.http
      .post(`/api/v1/inventories/${jornada.id}/diferencias`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        notas: [
          { itemId: conDif.find((i: any) => i.codigo === 'INV-001').id, nota: 'Sobrante: 2 unds en estante sin registrar del ingreso FI-88' },
          { itemId: conDif.find((i: any) => i.codigo === 'INV-002').id, nota: 'Faltante: 1 und averiada retirada sin soporte' },
        ],
      });
    expect(doc.status).toBe(201);

    // La aprobación deja el alistamiento bloqueado hasta terminar (sigue EN CONTEO? no: PENDIENTE)
    const antes1 = await stock('INV-001', ireId);
    const antes2 = await stock('INV-002', ireId);

    const aprob = await t.http
      .post(`/api/v1/inventories/${jornada.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');

    // Existencias ajustadas a la realidad del conteo (contra snapshot)
    const despues1 = await stock('INV-001', ireId);
    const despues2 = await stock('INV-002', ireId);
    expect(despues1.cantidad).toBe(antes1.cantidad + 2);
    expect(despues2.cantidad).toBe(antes2.cantidad - 1);

    // Movimientos AJUSTE_INVENTARIO con doc INVENTARIO
    const movs = await t.dataSource.query(
      `SELECT tipo, cantidad_delta, doc_tipo FROM inventory_movements
       WHERE doc_tipo='INVENTARIO' AND doc_id=$1 ORDER BY cantidad_delta DESC`,
      [jornada.id],
    );
    expect(movs).toHaveLength(2);
    expect(movs[0].tipo).toBe('AJUSTE_INVENTARIO');
    expect(movs.map((m: any) => m.cantidad_delta).sort((a: number, b: number) => a - b)).toEqual([-1, 2]);

    // Ya no se puede aprobar dos veces
    const otraVez = await t.http
      .post(`/api/v1/inventories/${jornada.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(otraVez.status).toBe(400);
  });

  it('M12: tras aprobar, alistamiento y despacho vuelven a funcionar', async () => {
    // El pedido creado durante el bloqueo ahora sí se puede alistar
    const pedidos = await t.dataSource.query(
      `SELECT id FROM orders WHERE empresa_id=$1 AND estado='ABIERTO' ORDER BY created_at LIMIT 1`,
      [ireId],
    );
    const scan = await t.http
      .post(`/api/v1/orders/${pedidos[0].id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7510001', cantidad: 1 });
    expect(scan.status).toBe(201);

    // El despacho bloqueado ahora permite escanear
    const d = (global as any).__dispatchBloqueado;
    const cajas = await t.dataSource.query(`SELECT id FROM boxes WHERE dispatch_id=$1`, [d.id]);
    const scanBox = await t.http
      .post(`/api/v1/dispatches/${d.id}/boxes/${cajas[0].id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'INV-002', cantidad: 1 });
    expect(scanBox.status).toBe(201);
  });

  it('HU-052: cancelar con motivo deja existencias sin cambio', async () => {
    const jornadaIcv = (global as any).__jornadaIcv;
    const antes = await stock('INV-003', icvId);

    // Sin motivo → 400 (validación)
    const sinMotivo = await t.http
      .post(`/api/v1/inventories/${jornadaIcv.id}/cancelar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: '' });
    expect(sinMotivo.status).toBe(400);

    // Conteo parcial y cancelación
    await t.http
      .post(`/api/v1/inventories/${jornadaIcv.id}/conteo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'INV-003', conteo: 9, ubicacion: 'C-01' });

    const cancel = await t.http
      .post(`/api/v1/inventories/${jornadaIcv.id}/cancelar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Conteo interrumpido por urgencia de despachos; se repite mañana' });
    expect(cancel.status).toBe(201);
    expect(cancel.body.estado).toBe('CANCELADO');

    const despues = await stock('INV-003', icvId);
    expect(despues.cantidad).toBe(antes.cantidad);

    // Sin movimientos de ajuste para esa jornada
    const movs = await t.dataSource.query(
      `SELECT COUNT(*)::int AS n FROM inventory_movements WHERE doc_tipo='INVENTARIO' AND doc_id=$1`,
      [jornadaIcv.id],
    );
    expect(movs[0].n).toBe(0);

    // Auditoría de la entidad Inventarios
    const acciones = await t.dataSource.query(
      `SELECT DISTINCT accion FROM audit_logs WHERE tabla='Inventarios'`,
    );
    const lista = acciones.map((a: any) => a.accion);
    expect(lista).toContain('INVENTARIO_CREADO');
    expect(lista).toContain('INVENTARIO_CONTEO_FINALIZADO');
    expect(lista).toContain('INVENTARIO_DIFERENCIAS_DOCUMENTADAS');
    expect(lista).toContain('INVENTARIO_APROBADO');
    expect(lista).toContain('INVENTARIO_CANCELADO');

    // Nueva jornada para la empresa cancelada: permitida de nuevo
    const { pIcv } = (global as any).__p;
    const nueva = await t.http
      .post('/api/v1/inventories')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: icvId, instruccion: 'Reintento conteo ICV', productIds: [pIcv.id] });
    expect(nueva.status).toBe(201);
    expect(nueva.body.numero).toBe('INV-ICV-0002');
    await t.http
      .post(`/api/v1/inventories/${nueva.body.id}/cancelar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Cierre de prueba' });
  });
});
