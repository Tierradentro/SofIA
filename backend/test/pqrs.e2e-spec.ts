import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

const PNG_SOPORTE = readFileSync(join(__dirname, 'fixtures', 'factura-ocr.png'));

/**
 * I9 — EP-08/M11: devoluciones (PQRS).
 * HU-043 (crear caso), HU-044 (búsqueda por producto/caja/factura/despacho),
 * HU-045 (factura manual), HU-046 (soportes con observación), HU-047 (motivo
 * obligatorio), CU-006 (con pedido asociado), CU-007 (sin pedido: factura
 * manual u observación obligatoria), ciclo de corrección (M11), solución y
 * cierre, cancelación por Generador y reingreso manual al inventario como
 * movimiento REINGRESO_DEVOLUCION.
 */
describe('Devoluciones PQRS (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let comercialToken: string;
  let ireId: string;
  let icvId: string;
  let clienteId: string;
  let comercialId: string;

  async function crearProducto(codigo: string, cantidad: number, empresaId: string, barcode?: string) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId, codigo, descripcion: `Producto ${codigo}`, unidadMedida: 'UND', precio: 9000 });
    expect(res.status).toBe(201);
    const producto = res.body;
    if (cantidad > 0) {
      await t.dataSource.query(`UPDATE products SET cantidad=$1 WHERE id=$2`, [cantidad, producto.id]);
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

  /** Pedido APROBADO con factura, alistado por API (ver I8). */
  async function crearPedidoConFactura(
    empresaId: string,
    items: { referencia: string; cantidad: number; scanCode: string }[],
    numeroFactura: string,
  ) {
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId,
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
    await t.http.post(`/api/v1/orders/${id}/finalizar-picking`).set('Authorization', `Bearer ${operadorToken}`);
    await t.dataSource.query(
      `UPDATE orders SET estado='APROBADO', aprobado_at=now(), numero_factura=$2 WHERE id=$1`,
      [id, numeroFactura],
    );
    const aprobado = await t.http.get(`/api/v1/orders/${id}`).set('Authorization', `Bearer ${generadorToken}`);
    expect(aprobado.body.estado).toBe('APROBADO');
    return aprobado.body;
  }

  /** Despacho DESPACHADO con una caja cerrada (para búsqueda por caja). */
  async function despachar(orderId: string, scanCode: string, cantidad: number) {
    const d = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId });
    expect(d.status).toBe(201);
    const dId = d.body.id;
    await t.http.post(`/api/v1/dispatches/${dId}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);
    const box = await t.http.post(`/api/v1/dispatches/${dId}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: scanCode, cantidad });
    await t.http.post(`/api/v1/dispatches/${dId}/boxes/${box.body.id}/cerrar`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http.post(`/api/v1/dispatches/${dId}/finalizar-empaque`).set('Authorization', `Bearer ${operadorToken}`);
    const salida = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia' });
    expect(salida.status).toBe(201);
    return { despacho: d.body, caja: box.body };
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
      .send({ nombre: 'Cliente Devoluciones', identificacion: '900777111', ciudad: 'Medellín', direccion: 'Cra 10 # 20-30' });
    clienteId = cli.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial PQRS', identificacion: 'C-P09' });
    comercialId = com.body.id;

    for (const [username, rol, extra] of [
      ['generador.i9', 'GENERADOR', {}],
      ['operador.i9', 'OPERADOR', {}],
      ['comercial.i9', 'COMERCIAL', { comercialId }],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i9', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i9', 'ClaveInicial1', 'ClaveNueva123');
    comercialToken = await loginAndSetPassword(t.http, 'comercial.i9', 'ClaveInicial1', 'ClaveNueva123');

    await crearProducto('PQRS-001', 10, ireId, '7508101');
    await crearProducto('PQRS-002', 6, icvId);
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-044: búsqueda por producto, caja, factura y despacho', async () => {
    const pedido = await crearPedidoConFactura(
      ireId,
      [{ referencia: 'PQRS-001', cantidad: 3, scanCode: '7508101' }],
      'FV-PQRS-001',
    );
    const { despacho, caja } = await despachar(pedido.id, '7508101', 3);
    (global as any).__pedido = pedido;
    (global as any).__despacho = despacho;
    (global as any).__caja = caja;

    // Por producto (código propio y barcode)
    const porProducto = await t.http
      .get('/api/v1/pqrs/buscar?codigo=7508101')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porProducto.status).toBe(200);
    expect(porProducto.body.pedidos.map((p: any) => p.id)).toContain(pedido.id);
    expect(porProducto.body.despachos.map((d: any) => d.id)).toContain(despacho.id);

    // Por caja (box_id del QR)
    const porCaja = await t.http
      .get(`/api/v1/pqrs/buscar?boxId=${caja.boxId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porCaja.body.cajas[0].boxId).toBe(caja.boxId);
    expect(porCaja.body.despachos.map((d: any) => d.id)).toContain(despacho.id);

    // Por factura
    const porFactura = await t.http
      .get('/api/v1/pqrs/buscar?factura=FV-PQRS-001')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porFactura.body.pedidos.map((p: any) => p.id)).toContain(pedido.id);

    // Por número de despacho
    const porDespacho = await t.http
      .get(`/api/v1/pqrs/buscar?despacho=${despacho.numero}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(porDespacho.body.despachos[0].id).toBe(despacho.id);
    expect(porDespacho.body.cajas.length).toBeGreaterThan(0);

    // Sin coincidencias → listas vacías (CU-007)
    const sinMatch = await t.http
      .get('/api/v1/pqrs/buscar?codigo=NOEXISTE')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(sinMatch.body.pedidos).toHaveLength(0);
  });

  it('HU-043 + CU-006: crear caso con pedido asociado (factura automática, motivo del catálogo)', async () => {
    const pedido = (global as any).__pedido;
    const despacho = (global as any).__despacho;
    const caja = (global as any).__caja;

    // RBAC: Generador no puede crear casos (actor: Operador)
    const prohibido = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ clienteId, codigo: 'PQRS-001', motivoCodigo: 'G08', descripcionCaso: 'x' });
    expect(prohibido.status).toBe(403);

    // Motivo inexistente → 400 (HU-047)
    const motivoMalo = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ clienteId, codigo: 'PQRS-001', motivoCodigo: 'Z99', descripcionCaso: 'x' });
    expect(motivoMalo.status).toBe(400);

    // Producto no asociado al pedido → 400
    const noEnPedido = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        clienteId, codigo: 'PQRS-002', motivoCodigo: 'G08',
        descripcionCaso: 'x', orderId: pedido.id,
      });
    expect(noEnPedido.status).toBe(400);

    const res = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        clienteId,
        comercialId,
        codigo: '7508101', // escaneo por barcode
        cantidad: 2,
        motivoCodigo: 'G08',
        detalle: 'La pieza no enciende al instalarla',
        descripcionCaso: 'Cliente reporta falla eléctrica al día siguiente de la instalación',
        prioridad: 'ALTA',
        orderId: pedido.id,
        dispatchId: despacho.id,
        boxId: caja.boxId,
      });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('ABIERTA');
    expect(res.body.factura).toBe('FV-PQRS-001'); // automática del pedido
    expect(res.body.facturaManual).toBe(false);
    expect(res.body.codigo).toBe('PQRS-001'); // snapshot del producto
    expect(res.body.prioridad).toBe('ALTA');
    expect(res.body.motivo.codigo).toBe('G08');
    expect(res.body.motivo.concepto).toBe('GARANTIA');
    expect(res.body.pedido.numero).toBe(pedido.numero);
    (global as any).__caso1 = res.body;
  });

  it('HU-045 + CU-007: sin coincidencia — factura manual u observación obligatoria', async () => {
    // Sin factura ni pedido ni observación → 400
    const sinNada = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ clienteId, codigo: 'PQRS-002', motivoCodigo: 'N04', descripcionCaso: 'Referencia incorrecta' });
    expect(sinNada.status).toBe(400);
    expect(sinNada.body.message).toContain('observación');

    // Con factura manual → ABIERTA con facturaManual=true
    const conFactura = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        clienteId, codigo: 'PQRS-002', cantidad: 1, motivoCodigo: 'N04',
        descripcionCaso: 'Referencia incorrecta facturada en otro sistema',
        factura: 'EXT-998877',
      });
    expect(conFactura.status).toBe(201);
    expect(conFactura.body.factura).toBe('EXT-998877');
    expect(conFactura.body.facturaManual).toBe(true);
    (global as any).__caso2 = conFactura.body;

    // Con observación (sin factura) → ABIERTA
    const conObs = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        clienteId, codigo: 'PQRS-002', cantidad: 1, motivoCodigo: 'N11',
        descripcionCaso: 'Cambio por decisión del cliente',
        facturaObservacion: 'Cliente no conserva la factura; compra verificada con el comercial',
      });
    expect(conObs.status).toBe(201);
    expect(conObs.body.factura).toBeNull();
    expect(conObs.body.facturaObservacion).toContain('no conserva');
  });

  it('HU-046: soportes fotográficos con observación (recepción y solución)', async () => {
    const caso1 = (global as any).__caso1;

    // Archivo no imagen → 400
    const noImagen = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .field('observacion', 'intento de pdf')
      .attach('file', Buffer.from('%PDF-1.4 fake'), { filename: 'x.pdf', contentType: 'application/pdf' });
    expect(noImagen.status).toBe(400);

    // Imagen con observación
    const sop = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .field('observacion', 'Foto de la pieza devuelta: conector quemado')
      .attach('file', PNG_SOPORTE, { filename: 'pieza.png', contentType: 'image/png' });
    expect(sop.status).toBe(201);
    expect(sop.body.tipo).toBe('RECEPCION');
    expect(sop.body.observacion).toContain('conector quemado');

    // Segunda imagen (una o varias, HU-046)
    const sop2 = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .attach('file', PNG_SOPORTE, { filename: 'pieza2.png', contentType: 'image/png' });
    expect(sop2.status).toBe(201);

    // Se ven en el detalle y se descargan
    const detalle = await t.http
      .get(`/api/v1/pqrs/${caso1.id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(detalle.body.soportes).toHaveLength(2);
    expect(detalle.body.soportes[0].nombreOriginal).toBe('pieza.png');

    const archivo = await t.http
      .get(`/api/v1/pqrs/soportes/${sop.body.id}/archivo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: any[] = [];
        res.on('data', (c: any) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(archivo.status).toBe(200);
    expect(archivo.headers['content-type']).toContain('image/png');
  });

  it('I25: el Generador retira un soporte cargado por error; el caso muestra su trazabilidad', async () => {
    const caso1 = (global as any).__caso1;

    // Operador adjunta un soporte "por error"
    const sopNuevo = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .field('observacion', 'Cargado por error')
      .attach('file', PNG_SOPORTE, { filename: 'error.png', contentType: 'image/png' });
    expect(sopNuevo.status).toBe(201);

    // Operador no puede retirar soportes → 403
    const prohibido = await t.http
      .delete(`/api/v1/pqrs/soportes/${sopNuevo.body.id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(prohibido.status).toBe(403);

    // Generador lo retira (caso ABIERTA) y queda en auditoría
    const retiro = await t.http
      .delete(`/api/v1/pqrs/soportes/${sopNuevo.body.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(retiro.status).toBe(200);
    const ids = retiro.body.soportes.map((s: any) => s.id);
    expect(ids).not.toContain(sopNuevo.body.id);
    expect(retiro.body.soportes).toHaveLength(2);

    const audit = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE accion='PQRS_SOPORTE_ELIMINADO' ORDER BY fecha_hora DESC LIMIT 1`,
    );
    expect(audit.length).toBe(1);

    // Trazabilidad visible: quién creó/recibió el caso
    const detalle = await t.http
      .get(`/api/v1/pqrs/${caso1.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(detalle.body.trazabilidad.creadoPor.username).toBe('operador.i9');
    expect(detalle.body.trazabilidad.atendidoPor).toBeNull();

    // Caso inexistente → 404
    const noExiste = await t.http
      .delete(`/api/v1/pqrs/soportes/00000000-0000-4000-8000-000000000000`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(noExiste.status).toBe(404);
  });

  it('M11 corrección: solicitar → PENDIENTE_CORRECCION; Generador corrige → ABIERTA', async () => {
    const caso2 = (global as any).__caso2;

    const sol = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/solicitar-correccion`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ motivo: 'La cantidad registrada no coincide con lo recibido' });
    expect(sol.status).toBe(201);
    expect(sol.body.estado).toBe('PENDIENTE_CORRECCION');

    // Operador no puede corregir (rol Generador)
    const opCorrige = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/corregir`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ motivoCorreccion: 'x', cantidad: 2 });
    expect(opCorrige.status).toBe(403);

    // No se puede cerrar en corrección
    const cerrarEnCorreccion = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ solucionCaso: 'x' });
    expect(cerrarEnCorreccion.status).toBe(400);

    // Generador corrige cantidad y motivo, y devuelve a ABIERTA
    const corregido = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/corregir`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivoCorreccion: 'Se verificó con recepción: eran 2 unidades y el motivo es N03', cantidad: 2, motivoCodigo: 'N03' });
    expect(corregido.status).toBe(201);
    expect(corregido.body.estado).toBe('ABIERTA');
    expect(corregido.body.cantidad).toBe(2);
    expect(corregido.body.motivoCodigo).toBe('N03');

    const audit = await t.dataSource.query(
      `SELECT accion, motivo FROM audit_logs WHERE tabla='Casos PQRS' AND registro_id=$1 ORDER BY fecha_hora`,
      [caso2.id],
    );
    expect(audit.map((a: any) => a.accion)).toEqual(
      expect.arrayContaining(['PQRS_CORRECCION_SOLICITADA', 'PQRS_CORREGIDO']),
    );
  });

  it('M11 Solución: Operador registra resultado y cierra; soporte de proveedor', async () => {
    const caso1 = (global as any).__caso1;

    // Sin solución → 400 (validación)
    const sinSol = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ solucionCaso: '' });
    expect(sinSol.status).toBe(400);

    // Generador no cierra (actor: Operador)
    const genCierra = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/cerrar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ solucionCaso: 'x' });
    expect(genCierra.status).toBe(403);

    const cerrado = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ solucionCaso: 'Proveedor acepta garantía: envía repuesto nuevo en 8 días' });
    expect(cerrado.status).toBe(201);
    expect(cerrado.body.estado).toBe('CERRADA');
    expect(cerrado.body.cerradaAt).toBeTruthy();

    // Soporte de respuesta del proveedor (M11 Solución)
    const sopSol = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .field('tipo', 'SOLUCION')
      .field('observacion', 'Carta de aprobación de garantía del proveedor')
      .attach('file', PNG_SOPORTE, { filename: 'carta.png', contentType: 'image/png' });
    expect(sopSol.status).toBe(201);
    expect(sopSol.body.tipo).toBe('SOLUCION');

    // Un caso CERRADA no se cancela
    const cancelarCerrado = await t.http
      .post(`/api/v1/pqrs/${caso1.id}/cancelar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(cancelarCerrado.status).toBe(400);
  });

  it('Reingreso manual: Generador devuelve existencias como movimiento REINGRESO_DEVOLUCION', async () => {
    const caso2 = (global as any).__caso2; // 2 unidades de PQRS-002 (ICV) tras corrección
    const antes = await stock('PQRS-002', icvId);

    // Operador no reingresa (rol Generador)
    const opReingresa = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/reingresar`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    expect(opReingresa.status).toBe(403);

    // Excedente → 400
    const excedente = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/reingresar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ cantidad: 3 });
    expect(excedente.status).toBe(400);
    expect(excedente.body.message).toContain('Excede');

    // Reingreso parcial (1) y luego el resto (1)
    const r1 = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/reingresar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ cantidad: 1, notas: 'Una unidad en buen estado vuelve a estantería' });
    expect(r1.status).toBe(201);
    expect(r1.body.cantidadReingresada).toBe(1);
    const r2 = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/reingresar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(r2.status).toBe(201);
    expect(r2.body.cantidadReingresada).toBe(2);

    // Nada más por reingresar → 400
    const r3 = await t.http
      .post(`/api/v1/pqrs/${caso2.id}/reingresar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(r3.status).toBe(400);

    const despues = await stock('PQRS-002', icvId);
    expect(despues.cantidad).toBe(antes.cantidad + 2);

    const movs = await t.dataSource.query(
      `SELECT tipo, cantidad_delta, doc_tipo FROM inventory_movements
       WHERE doc_tipo='PQRS' AND doc_id=$1`,
      [caso2.id],
    );
    expect(movs).toHaveLength(2);
    for (const m of movs) {
      expect(m.tipo).toBe('REINGRESO_DEVOLUCION');
      expect(m.cantidad_delta).toBe(1);
    }
  });

  it('Cancelación por Generador en cualquier parte del flujo', async () => {
    // Caso nuevo ABIERTA
    const caso = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        clienteId, codigo: 'PQRS-001', cantidad: 1, motivoCodigo: 'G40',
        descripcionCaso: 'Otro defecto reportado por el cliente',
        facturaObservacion: 'Sin factura física',
      });
    expect(caso.status).toBe(201);

    // Operador no cancela
    const opCancela = await t.http
      .post(`/api/v1/pqrs/${caso.body.id}/cancelar`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    expect(opCancela.status).toBe(403);

    const cancelado = await t.http
      .post(`/api/v1/pqrs/${caso.body.id}/cancelar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Caso duplicado por error de digitación' });
    expect(cancelado.status).toBe(201);
    expect(cancelado.body.estado).toBe('CANCELADA');
    expect(cancelado.body.motivoCancelacion).toContain('duplicado');

    // Un caso CANCELADA no admite cierre ni reingreso
    const cerrar = await t.http
      .post(`/api/v1/pqrs/${caso.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ solucionCaso: 'x' });
    expect(cerrar.status).toBe(400);
    const reingresar = await t.http
      .post(`/api/v1/pqrs/${caso.body.id}/reingresar`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(reingresar.status).toBe(400);
  });

  it('Consulta, filtros y auditoría obligatoria de Casos PQRS', async () => {
    // Lista por estado y por cliente (M02: el Comercial solo ve los casos de su
    // comercial — verificado en queries.e2e-spec.ts — así que aquí se usa el
    // Generador, que tiene visión global, para validar los filtros)
    const abiertas = await t.http
      .get('/api/v1/pqrs?estado=ABIERTA')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(abiertas.status).toBe(200);
    expect(abiertas.body.every((c: any) => c.estado === 'ABIERTA')).toBe(true);

    const porCliente = await t.http
      .get(`/api/v1/pqrs?clienteId=${clienteId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(porCliente.body.length).toBeGreaterThanOrEqual(4);
    expect(porCliente.body[0].clienteNombre).toBe('Cliente Devoluciones');

    // Catálogo de motivos completo (G01–G40, N01–N18)
    const motivos = await t.http
      .get('/api/v1/pqrs/motivos')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(motivos.body).toHaveLength(58);
    expect(motivos.body.filter((m: any) => m.concepto === 'GARANTIA')).toHaveLength(40);
    expect(motivos.body.filter((m: any) => m.concepto === 'GARANTIA_NO_APLICA')).toHaveLength(18);

    // Auditoría de las acciones del ciclo
    const acciones = await t.dataSource.query(
      `SELECT DISTINCT accion FROM audit_logs WHERE tabla='Casos PQRS'`,
    );
    const lista = acciones.map((a: any) => a.accion);
    expect(lista).toContain('PQRS_CREADO');
    expect(lista).toContain('PQRS_SOPORTE_ADJUNTADO');
    expect(lista).toContain('PQRS_CERRADO');
    expect(lista).toContain('PQRS_CANCELADO');
    expect(lista).toContain('PQRS_REINGRESO');
  });
});
