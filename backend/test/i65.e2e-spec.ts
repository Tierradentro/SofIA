import * as XLSX from 'xlsx';
import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

function xlsxBuffer(filas: any[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/**
 * I65 — ajustes de la iteración 65:
 *  - I65b: devolver un pedido Alistado a Abierto (todos los perfiles) con
 *    reversa de la bahía de empaque y liberación de bloqueos.
 *  - I65c: eliminar una caja creada por error (despacho no despachado),
 *    elementos libres y consecutivo CJA reciclable.
 *  - I65e: el Operador corrige códigos de barras (PUT /products/:id/barcode).
 *  - I65f: la bahía de empaque indica a qué pedido pertenece cada producto.
 *  - I65g: importación de clientes con solo identificación + correo.
 *  - I65h: conciliación WO vs. SofIA (existencias, precios, campos).
 */
describe('I65 ajustes (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let comercialToken: string;
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

  async function crearPedido(items: any[]) {
    const res = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, comercialId, items });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function alistarCompleto(orderId: string, codigo: string, cantidad: number) {
    const scan = await t.http
      .post(`/api/v1/orders/${orderId}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo, cantidad });
    expect(scan.status).toBe(201);
    const fin = await t.http
      .post(`/api/v1/orders/${orderId}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
  }

  async function stock(codigo: string) {
    const rows = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE codigo=$1 AND empresa_id=$2`,
      [codigo, ireId],
    );
    return rows[0];
  }

  async function enBahia(productoId: string): Promise<number> {
    const rows = await t.dataSource.query(
      `SELECT COALESCE(SUM(l.cantidad),0)::int AS n
         FROM warehouse_product_locations l
         JOIN warehouse_areas a ON a.id = l.area_id
        WHERE l.product_id=$1 AND a.tipo='BAHIA_EMPAQUE'`,
      [productoId],
    );
    return rows[0].n;
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);

    for (const [username, rol] of [
      ['generador.i65', 'GENERADOR'],
      ['operador.i65', 'OPERADOR'],
      ['comercial.i65', 'COMERCIAL'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i65', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i65', 'ClaveInicial1', 'ClaveNueva123');
    comercialToken = await loginAndSetPassword(t.http, 'comercial.i65', 'ClaveInicial1', 'ClaveNueva123');

    const emp = await t.http.get('/api/v1/companies').set('Authorization', `Bearer ${adminToken}`);
    ireId = emp.body.find((c: any) => c.nombre === 'IRE').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente I65', identificacion: '900-I65', ciudad: 'Bogotá' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;

    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial I65', identificacion: 'C-I65' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    // Bodega con bahía de empaque (área fija del asistente)
    const conf = await t.http
      .post('/api/v1/warehouses/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Bodega I65',
        forma: 'RECTANGULO',
        anchoM: 40,
        altoM: 30,
        pisos: [
          {
            numero: 1,
            tieneAreasFijas: true,
            pasillos: [
              { numero: 1, zonas: [{ lado: 'IZQUIERDA', estantes: [{ numero: 1, niveles: 2 }] }] },
            ],
          },
        ],
      });
    expect(conf.status).toBe(201);
  }, 120000);

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  // ---------------------------------------------------------------
  // I65b: Alistado → Abierto
  // ---------------------------------------------------------------
  it('I65b: devuelve Alistado a Abierto, saca de la bahía y libera bloqueos (todos los perfiles)', async () => {
    const producto = await crearProducto('REV-001', 10);
    const pedido = await crearPedido([{ referencia: 'REV-001', cantidad: 4 }]);
    await alistarCompleto(pedido.id, 'REV-001', 4);

    // En la bahía y bloqueadas antes de revertir
    expect(await enBahia(producto.id)).toBe(4);
    let st = await stock('REV-001');
    expect(st.cantidad_bloqueada).toBe(4);

    // Cualquier perfil puede hacerlo: aquí lo hace el Comercial
    const rev = await t.http
      .post(`/api/v1/orders/${pedido.id}/revertir-alistamiento`)
      .set('Authorization', `Bearer ${comercialToken}`);
    expect(rev.status).toBe(201);
    expect(rev.body.estado).toBe('ABIERTO');
    expect(rev.body.items[0].cantidadAlistada).toBe(0);

    // Fuera de la bahía y bloqueo liberado
    expect(await enBahia(producto.id)).toBe(0);
    st = await stock('REV-001');
    expect(st.cantidad).toBe(10);
    expect(st.cantidad_bloqueada).toBe(0);

    // Auditoría
    const audit = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE registro_id=$1 AND accion='PEDIDO_REVERTIDO_A_ABIERTO'`,
      [pedido.id],
    );
    expect(audit).toHaveLength(1);

    // Revertir un pedido que ya no está Alistado → 400
    const doble = await t.http
      .post(`/api/v1/orders/${pedido.id}/revertir-alistamiento`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(doble.status).toBe(400);

    // Se puede volver a alistar el pedido corregido
    await alistarCompleto(pedido.id, 'REV-001', 4);
    expect(await enBahia(producto.id)).toBe(4);
  });

  // ---------------------------------------------------------------
  // I65f: la bahía indica el pedido de cada producto
  // ---------------------------------------------------------------
  it('I65f: el detalle de la bahía de empaque muestra el pedido asociado', async () => {
    const area = await t.dataSource.query(
      `SELECT id FROM warehouse_areas WHERE tipo='BAHIA_EMPAQUE' AND activo=true LIMIT 1`,
    );
    expect(area).toHaveLength(1);
    const det = await t.http
      .get(`/api/v1/warehouses/areas/${area[0].id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(det.status).toBe(200);
    const fila = det.body.productos.find((p: any) => p.codigo === 'REV-001');
    expect(fila).toBeDefined();
    expect(fila.pedidos).toHaveLength(1);
    expect(fila.pedidos[0].cantidad).toBe(4);
    expect(fila.pedidos[0].numero).toMatch(/^IRE-/);
  });
});

// Segunda parte: cajas (I65c), barcodes (I65e), importación clientes (I65g)
// y conciliaciones (I65h) — describe aparte para aislar la BD.

describe('I65 cajas, barcodes, clientes y conciliaciones (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let comercialToken: string;
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

  async function stock(codigo: string) {
    const rows = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE codigo=$1 AND empresa_id=$2`,
      [codigo, ireId],
    );
    return rows[0];
  }

  async function enBahia(productoId: string): Promise<number> {
    const rows = await t.dataSource.query(
      `SELECT COALESCE(SUM(l.cantidad),0)::int AS n
         FROM warehouse_product_locations l
         JOIN warehouse_areas a ON a.id = l.area_id
        WHERE l.product_id=$1 AND a.tipo='BAHIA_EMPAQUE'`,
      [productoId],
    );
    return rows[0].n;
  }

  /** Pedido APROBADO con un ítem (alistado por API y aprobado directo). */
  async function crearPedidoAprobado(codigo: string, cantidad: number) {
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, comercialId, items: [{ referencia: codigo, cantidad }] });
    expect(pedido.status).toBe(201);
    const scan = await t.http
      .post(`/api/v1/orders/${pedido.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo, cantidad });
    expect(scan.status).toBe(201);
    const fin = await t.http
      .post(`/api/v1/orders/${pedido.body.id}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    await t.dataSource.query(
      `UPDATE orders SET estado='APROBADO', aprobado_at=now() WHERE id=$1`,
      [pedido.body.id],
    );
    return pedido.body;
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);

    for (const [username, rol] of [
      ['generador.i65b', 'GENERADOR'],
      ['operador.i65b', 'OPERADOR'],
      ['comercial.i65b', 'COMERCIAL'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i65b', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i65b', 'ClaveInicial1', 'ClaveNueva123');
    comercialToken = await loginAndSetPassword(t.http, 'comercial.i65b', 'ClaveInicial1', 'ClaveNueva123');

    const emp = await t.http.get('/api/v1/companies').set('Authorization', `Bearer ${adminToken}`);
    ireId = emp.body.find((c: any) => c.nombre === 'IRE').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente I65b', identificacion: '901-I65', ciudad: 'Bogotá' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;

    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial I65b', identificacion: 'C-I65B' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    const conf = await t.http
      .post('/api/v1/warehouses/configure')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Bodega I65b',
        forma: 'RECTANGULO',
        anchoM: 40,
        altoM: 30,
        pisos: [
          {
            numero: 1,
            tieneAreasFijas: true,
            pasillos: [
              { numero: 1, zonas: [{ lado: 'IZQUIERDA', estantes: [{ numero: 1, niveles: 2 }] }] },
            ],
          },
        ],
      });
    expect(conf.status).toBe(201);
  }, 120000);

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  // ---------------------------------------------------------------
  // I65c: eliminar caja
  // ---------------------------------------------------------------
  it('I65c: elimina cajas no despachadas, libera los elementos y recicla el consecutivo', async () => {
    const producto = await crearProducto('CAJ-001', 10);
    const pedido = await crearPedidoAprobado('CAJ-001', 5);

    const desp = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedido.id });
    expect(desp.status).toBe(201);
    const apr = await t.http
      .post(`/api/v1/dispatches/${desp.body.id}/aprobar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(apr.status).toBe(201);

    // Caja 1 (ABIERTA con 2) y caja 2 (CERRADA con 3)
    const b1 = await t.http
      .post(`/api/v1/dispatches/${desp.body.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(b1.status).toBe(201);
    const scan1 = await t.http
      .post(`/api/v1/dispatches/${desp.body.id}/boxes/${b1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'CAJ-001', cantidad: 2 });
    expect(scan1.status).toBe(201);

    const b2 = await t.http
      .post(`/api/v1/dispatches/${desp.body.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const scan2 = await t.http
      .post(`/api/v1/dispatches/${desp.body.id}/boxes/${b2.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: 'CAJ-001', cantidad: 3 });
    expect(scan2.status).toBe(201);
    const cierre = await t.http
      .post(`/api/v1/dispatches/${desp.body.id}/boxes/${b2.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(cierre.status).toBe(201);

    // Tras el cierre: 10 - 3 en stock y 5 bloqueadas - 3 = 2 bloqueadas
    let st = await stock('CAJ-001');
    expect(st.cantidad).toBe(7);
    expect(st.cantidad_bloqueada).toBe(2);
    expect(await enBahia(producto.id)).toBe(2);

    // Comercial no puede eliminar cajas (RBAC)
    const prohibido = await t.http
      .delete(`/api/v1/dispatches/${desp.body.id}/boxes/${b1.body.id}`)
      .set('Authorization', `Bearer ${comercialToken}`);
    expect(prohibido.status).toBe(403);

    // Eliminar la caja ABIERTA: el conteo se libera, sin tocar existencias
    const del1 = await t.http
      .delete(`/api/v1/dispatches/${desp.body.id}/boxes/${b1.body.id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(del1.status).toBe(200);
    expect(del1.body.elementosLiberados).toBe(2);
    st = await stock('CAJ-001');
    expect(st.cantidad).toBe(7);
    expect(st.cantidad_bloqueada).toBe(2);

    // Eliminar la caja CERRADA (era la última): revierte descuento y bloqueo
    const del2 = await t.http
      .delete(`/api/v1/dispatches/${desp.body.id}/boxes/${b2.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del2.status).toBe(200);
    expect(del2.body.elementosLiberados).toBe(3);
    st = await stock('CAJ-001');
    expect(st.cantidad).toBe(10);
    expect(st.cantidad_bloqueada).toBe(5);
    expect(await enBahia(producto.id)).toBe(5);

    // El consecutivo global se recicla: con las dos cajas eliminadas el
    // contador vuelve al máximo restante (0) y la nueva caja reusa un número
    // ya asignado antes (CJA-000001), no uno nuevo (CJA-000003).
    const b3 = await t.http
      .post(`/api/v1/dispatches/${desp.body.id}/boxes`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(b3.status).toBe(201);
    expect(b3.body.boxId).toBe(b1.body.boxId);

    // Auditoría de ambas eliminaciones
    const audit = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE registro_id=$1 AND accion='DESPACHO_CAJA_ELIMINADA'`,
      [desp.body.id],
    );
    expect(audit).toHaveLength(2);

    // Un despacho DESPACHADO no permite eliminar cajas
    const boxRow = await t.dataSource.query(
      `SELECT id FROM boxes WHERE dispatch_id=$1 LIMIT 1`,
      [desp.body.id],
    );
    await t.dataSource.query(`UPDATE dispatches SET estado='DESPACHADO' WHERE id=$1`, [desp.body.id]);
    const tardio = await t.http
      .delete(`/api/v1/dispatches/${desp.body.id}/boxes/${boxRow[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(tardio.status).toBe(400);
  });

  // ---------------------------------------------------------------
  // I65e: el Operador corrige códigos de barras
  // ---------------------------------------------------------------
  it('I65e: el Operador corrige el código de barras; el Comercial no', async () => {
    const producto = await crearProducto('BAR-001', 0, '7500010');

    const correccion = await t.http
      .put(`/api/v1/products/${producto.id}/barcode`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ barcode: '7500011', origen: 'MANUAL' });
    expect(correccion.status).toBe(200);

    const ficha = await t.dataSource.query(
      `SELECT barcode FROM product_barcodes WHERE product_id=$1`,
      [producto.id],
    );
    expect(ficha[0].barcode).toBe('7500011');

    const prohibido = await t.http
      .put(`/api/v1/products/${producto.id}/barcode`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ barcode: '7500099', origen: 'MANUAL' });
    expect(prohibido.status).toBe(403);
  });

  // ---------------------------------------------------------------
  // I65g: importación de clientes con solo identificación + correo
  // ---------------------------------------------------------------
  it('I65g: importa solo identificación + correo y actualiza el email del cliente existente', async () => {
    const buffer = xlsxBuffer([
      { Identificacion: '901-I65', Email: 'Facturacion@ClienteI65.com' },
      { Identificacion: '999-NUEVO', Email: 'nuevo@sofia.local' },
    ]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'CLIENTES')
      .field('mapeo', JSON.stringify({ Identificacion: 'identificacion', Email: 'email' }))
      .attach('file', buffer, { filename: 'correos.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    expect(res.body.resumen.validas).toBe(2);

    const approve = await t.http
      .post(`/api/v1/imports/${res.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(approve.status).toBe(201);
    expect(approve.body.resumen.aplicado.correosActualizados).toBe(1);
    // El identificador desconocido no se crea sin nombre: se reporta incompleto
    expect(approve.body.resumen.aplicado.incompletas).toBe(1);
    expect(approve.body.resumen.aplicado.nuevos).toBe(0);

    const cliente = await t.dataSource.query(
      `SELECT email FROM clients WHERE identificacion='901-I65'`,
    );
    expect(cliente[0].email).toBe('facturacion@clientei65.com');
  });

  it('I65g: sin identificación ni nombre mapeados, la validación rechaza el mapeo', async () => {
    const buffer = xlsxBuffer([{ Correo: 'a@b.com' }]);
    const res = await t.http
      .post('/api/v1/imports')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipo', 'CLIENTES')
      .field('mapeo', JSON.stringify({ Correo: 'email' }))
      .attach('file', buffer, { filename: 'sollave.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('COLUMNAS_FALTANTES');
  });

  // ---------------------------------------------------------------
  // I65h: conciliaciones
  // ---------------------------------------------------------------
  it('I65h: concilia el archivo WO contra SofIA y reporta diferencias (solo Administrador)', async () => {
    await crearProducto('CONC-001', 7);
    await crearProducto('CONC-002', 3);

    const buffer = xlsxBuffer([
      { Referencia: 'CONC-001', Descripción: 'Producto CONC-001', Existencia: '5', Precio: '5.000' },
      { Referencia: 'CONC-002', Descripción: 'Producto CONC-002', Existencia: '3', Precio: '5.000' },
      { Referencia: 'CONC-999', Descripción: 'No existe', Existencia: '1', Precio: '1.000' },
    ]);

    // Paso 1: columnas
    const cols = await t.http
      .post('/api/v1/conciliaciones/columnas')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', buffer, { filename: 'wo.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(cols.status).toBe(201);
    expect(cols.body.columnas).toContain('Referencia');

    // Paso 2: conciliar
    const res = await t.http
      .post('/api/v1/conciliaciones')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('empresaId', ireId)
      .field('mapeo', JSON.stringify({
        Referencia: 'codigo',
        Descripción: 'descripcion',
        Existencia: 'existencia',
        Precio: 'precio',
      }))
      .attach('file', buffer, { filename: 'wo.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(res.status).toBe(201);
    expect(res.body.totalArchivo).toBe(3);
    expect(res.body.coinciden).toBe(1); // CONC-002
    expect(res.body.conDiferencias).toBe(1); // CONC-001 (existencia 5 vs 7)
    expect(res.body.noEncontrados).toBe(1); // CONC-999
    const dif = res.body.filas.find((f: any) => f.codigo === 'CONC-001');
    expect(dif.diferencias).toEqual([
      { campo: 'existencia', valorWo: '5', valorSofia: '7' },
    ]);
    // CAJ-001 (cantidad 10) y BAR-001 (precio 5000) no vinieron en el archivo
    const faltantes = res.body.filas.filter((f: any) => f.estado === 'FALTANTE_EN_WO');
    expect(faltantes.map((f: any) => f.codigo).sort()).toEqual(['BAR-001', 'CAJ-001']);

    // RBAC: solo Administrador
    const prohibido = await t.http
      .post('/api/v1/conciliaciones')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('empresaId', ireId)
      .field('mapeo', '{}')
      .attach('file', buffer, { filename: 'wo.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(prohibido.status).toBe(403);

    // Auditoría
    const audit = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE accion='CONCILIACION_EJECUTADA'`,
    );
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });
});
