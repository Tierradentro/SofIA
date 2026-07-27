import { readFileSync } from 'fs';
import { join } from 'path';
import * as XLSX from 'xlsx';
import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

const PNG_FACTURA = readFileSync(join(__dirname, 'fixtures', 'factura-venta.png'));

/**
 * I7 — EP-07/M08: pedidos y alistamiento.
 * HU-028 (crear manual/OCR/Excel, consecutivo por empresa, validación de
 * disponibilidad), HU-029/030 (alistamiento con escaneo, bloqueo por lectura,
 * excedentes), HU-031 (sin barcode: asociación CU-002), corrección
 * (Pendiente_Corrección → Abierto), HU-032 (factura de venta con
 * comparación estricta), cancelación con liberación de bloqueos.
 */
describe('Pedidos y alistamiento (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let comercialToken: string;
  let ireId: string;
  let icvId: string;
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
    const producto = res.body;
    if (cantidad > 0) {
      await t.dataSource.query(
        `UPDATE products SET cantidad=$1 WHERE id=$2`,
        [cantidad, producto.id],
      );
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

  async function crearPedido(items: any[], token = generadorToken, extra: any = {}) {
    return t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ empresaId: ireId, clienteId, comercialId, items, ...extra });
  }

  async function alistarCompleto(orderId: string, scans: { modo: string; productId?: string; codigo: string; cantidad: number }[]) {
    for (const s of scans) {
      const r = await t.http
        .post(`/api/v1/orders/${orderId}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send(s);
      expect(r.status).toBe(201);
    }
    return t.http
      .post(`/api/v1/orders/${orderId}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
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

    // Cliente y comercial (globales)
    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Autorepuestos Norte', identificacion: '900111222', ciudad: 'Bogotá', direccion: 'Calle 1 # 2-3' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Uno', identificacion: 'C-001' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    for (const [username, rol, extra] of [
      ['generador.i7', 'GENERADOR', {}],
      ['operador.i7', 'OPERADOR', {}],
      ['comercial.i7', 'COMERCIAL', { comercialId }],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i7', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i7', 'ClaveInicial1', 'ClaveNueva123');
    comercialToken = await loginAndSetPassword(t.http, 'comercial.i7', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-028: crea pedido manual con consecutivo por empresa y comercial requerido', async () => {
    await crearProducto('ORD-001', 20, '7501001');
    await crearProducto('ORD-002', 10);
    await crearProducto('ORD-003', 5);

    // Sin comercial (Generador) → 400
    const sinComercial = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, items: [{ referencia: 'ORD-001', cantidad: 1 }] });
    expect(sinComercial.status).toBe(400);
    expect(sinComercial.body.message).toContain('comercial');

    const p1 = await crearPedido([{ referencia: 'ORD-001', cantidad: 3 }]);
    expect(p1.status).toBe(201);
    expect(p1.body.numero).toBe('IRE-0001');
    expect(p1.body.estado).toBe('ABIERTO');
    expect(p1.body.items[0].valorUnidad).toBe('5000.00'); // precio sugerido
    expect(p1.body.valorTotal).toBe(15000);

    const p2 = await crearPedido([{ referencia: 'ORD-002', cantidad: 2, valorUnidad: 4500 }]);
    expect(p2.body.numero).toBe('IRE-0002');
    expect(p2.body.items[0].valorUnidad).toBe('4500.00'); // negociado (M08)

    // Consecutivo independiente por empresa (ICV inicia en 1)
    const pIcv = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: icvId,
        clienteId,
        comercialId,
        items: [{ referencia: 'ORD-001', cantidad: 1 }],
      });
    expect(pIcv.status).toBe(400); // el producto no existe en ICV (multiempresa)

    // Comercial: campo comercial automático (M06)
    const pCom = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ empresaId: ireId, clienteId, items: [{ referencia: 'ORD-001', cantidad: 1 }] });
    expect(pCom.status).toBe(201);
    expect(pCom.body.comercialId).toBe(comercialId);
    expect(pCom.body.numero).toBe('IRE-0003');

    // Sin disponibilidad → 400 (cantidad − bloqueada)
    const sinDisp = await crearPedido([{ referencia: 'ORD-003', cantidad: 7 }]);
    expect(sinDisp.status).toBe(400);
    expect(sinDisp.body.message).toContain('Sin disponibilidad');
  });

  it('HU-029/030: alistamiento modo COMPLETO con bloqueo por lectura y excedentes', async () => {
    const pedido = await crearPedido([{ referencia: 'ORD-001', cantidad: 2 }]);
    const id = pedido.body.id;

    // Código no asociado a ningún producto → mensaje para seleccionar
    const desconocido = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '9999999' });
    expect(desconocido.status).toBe(400);
    expect(desconocido.body.code).toBe('CODIGO_NO_ASOCIADO');
    expect(desconocido.body.message).toContain('seleccione el producto');

    // Escanear 2 unidades: cuenta y bloquea
    for (let i = 0; i < 2; i++) {
      const scan = await t.http
        .post(`/api/v1/orders/${id}/scan`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ modo: 'COMPLETO', codigo: '7501001' });
      expect(scan.status).toBe(201);
      expect(scan.body.items[0].cantidadAlistada).toBe(i + 1);
      expect(scan.body.items[0].pendiente).toBe(1 - i);
    }
    const prod = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE codigo='ORD-001' AND empresa_id=$1`,
      [ireId],
    );
    expect(prod[0].cantidad_bloqueada).toBe(2);
    expect(prod[0].cantidad).toBe(20); // la cantidad no baja hasta el despacho

    // Excedente → 400
    const excedente = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7501001' });
    expect(excedente.status).toBe(400);
    expect(excedente.body.message).toContain('Excedente');

    // Finalizar completo → ALISTADO
    const fin = await t.http
      .post(`/api/v1/orders/${id}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    expect(fin.body.estado).toBe('ALISTADO');
  });

  it('HU-031: producto sin barcode — modo INICIAL asocia código y cuenta (CU-002)', async () => {
    const pedido = await crearPedido([{ referencia: 'ORD-002', cantidad: 2 }]);
    const id = pedido.body.id;
    const item = pedido.body.items[0];

    // Modo INICIAL sin seleccionar producto → 400
    const sinSeleccion = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'INICIAL', codigo: '7502002' });
    expect(sinSeleccion.status).toBe(400);

    // Selecciona producto y escanea/digita código nuevo → se asocia y cuenta
    const scan = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'INICIAL', productId: item.productId, codigo: '7502002' });
    expect(scan.status).toBe(201);
    expect(scan.body.items[0].cantidadAlistada).toBe(1);
    const barcode = await t.dataSource.query(
      `SELECT barcode, origen FROM product_barcodes WHERE product_id=$1`,
      [item.productId],
    );
    expect(barcode[0].barcode).toBe('7502002');

    // El mismo código en otro producto → 409 BARCODE_DUPLICADO (un barcode por producto)
    const otro = await crearProducto('ORD-004', 3);
    const pedido2 = await crearPedido([{ referencia: 'ORD-002', cantidad: 1 }, { referencia: 'ORD-004', cantidad: 1 }]);
    const itemOtro = pedido2.body.items.find((i: any) => i.codigo === 'ORD-004');
    const duplicado = await t.http
      .post(`/api/v1/orders/${pedido2.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'INICIAL', productId: itemOtro.productId, codigo: '7502002' });
    expect(duplicado.status).toBe(409);
    expect(duplicado.body.code).toBe('BARCODE_DUPLICADO');

    // Cancelar pedido2 para no afectar siguientes pruebas
    await t.http
      .post(`/api/v1/orders/${pedido2.body.id}/cancel`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
  });

  it('Corrección: reportar → Pendiente_Corrección → corregir (libera bloqueos) → Abierto → alistar', async () => {
    const pedido = await crearPedido([
      { referencia: 'ORD-001', cantidad: 2 },
      { referencia: 'ORD-003', cantidad: 2 },
    ]);
    const id = pedido.body.id;
    // Alistar solo ORD-001 (2 unidades)
    await t.http.post(`/api/v1/orders/${id}/scan`).set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7501001', cantidad: 2 });

    // ORD-003 no se encuentra en bodega → reportar
    const rep = await t.http
      .post(`/api/v1/orders/${id}/reportar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(rep.body.estado).toBe('PENDIENTE_CORRECCION');

    // El creador (Generador) corrige: elimina ORD-003, deja ORD-001 en 2
    const corr = await t.http
      .patch(`/api/v1/orders/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ items: [{ referencia: 'ORD-001', cantidad: 2 }] });
    expect(corr.status).toBe(200);
    expect(corr.body.estado).toBe('ABIERTO');
    expect(corr.body.items).toHaveLength(1);
    expect(corr.body.items[0].cantidadAlistada).toBe(2); // se conserva lo alistado

    // Finaliza sin más escaneos
    const fin = await t.http
      .post(`/api/v1/orders/${id}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.body.estado).toBe('ALISTADO');

    // Caso 2: reducir por debajo de lo alistado libera la diferencia
    const pedidoB = await crearPedido([{ referencia: 'ORD-001', cantidad: 3 }]);
    const idB = pedidoB.body.id;
    await t.http.post(`/api/v1/orders/${idB}/scan`).set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7501001', cantidad: 3 });
    await t.http.post(`/api/v1/orders/${idB}/reportar`).set('Authorization', `Bearer ${operadorToken}`);
    const corrB = await t.http
      .patch(`/api/v1/orders/${idB}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ items: [{ referencia: 'ORD-001', cantidad: 2 }] });
    expect(corrB.status).toBe(200);
    expect(corrB.body.items[0].cantidadAlistada).toBe(2);
    const bloqueos = await t.dataSource.query(
      `SELECT cantidad_bloqueada FROM products WHERE codigo='ORD-001' AND empresa_id=$1`,
      [ireId],
    );
    // 2 (test alistamiento) + 2 (pedido ALISTADO anterior) + 2 (este) = 6
    expect(bloqueos[0].cantidad_bloqueada).toBe(6);
  });

  it('HU-032: factura de venta — diferencias bloquean; coincidencia total → APROBADO', async () => {
    // Pedido que NO coincide con la fixture (FV: ORD-001 x3, ORD-002 x2)
    const malo = await crearPedido([{ referencia: 'ORD-001', cantidad: 2 }]);
    await alistarCompleto(malo.body.id, [
      { modo: 'COMPLETO', codigo: '7501001', cantidad: 2 },
    ]);

    const ocr = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_VENTA')
      .attach('file', PNG_FACTURA, { filename: 'fv.png', contentType: 'image/png' });
    expect(ocr.status).toBe(201);

    const conDif = await t.http
      .post(`/api/v1/orders/${malo.body.id}/invoice`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocr.body.id });
    expect(conDif.status).toBe(400);
    expect(conDif.body.code).toBe('FACTURA_CON_DIFERENCIAS');
    expect(conDif.body.diferencias.length).toBeGreaterThan(0);
    // No cambió de estado
    const sigueAlistado = await t.http
      .get(`/api/v1/orders/${malo.body.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(sigueAlistado.body.estado).toBe('ALISTADO');

    // Pedido que SÍ coincide con la factura
    const bueno = await crearPedido([
      { referencia: 'ORD-001', cantidad: 3 },
      { referencia: 'ORD-002', cantidad: 2 },
    ]);
    await alistarCompleto(bueno.body.id, [
      { modo: 'COMPLETO', codigo: '7501001', cantidad: 3 },
      { modo: 'COMPLETO', codigo: '7502002', cantidad: 2 },
    ]);
    const aprob = await t.http
      .post(`/api/v1/orders/${bueno.body.id}/invoice`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocr.body.id });
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');
    expect(aprob.body.numeroFactura).toBe('FV-2026-0007');
  });

  it('Cancelación: libera cantidades bloqueadas y queda CANCELADO', async () => {
    const pedido = await crearPedido([{ referencia: 'ORD-001', cantidad: 2 }]);
    const id = pedido.body.id;
    const antes = await t.dataSource.query(
      `SELECT cantidad_bloqueada FROM products WHERE codigo='ORD-001' AND empresa_id=$1`,
      [ireId],
    );
    await t.http.post(`/api/v1/orders/${id}/scan`).set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7501001', cantidad: 2 });

    const cancel = await t.http
      .post(`/api/v1/orders/${id}/cancel`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Cliente desistió' });
    expect(cancel.status).toBe(201);
    expect(cancel.body.estado).toBe('CANCELADO');

    const despues = await t.dataSource.query(
      `SELECT cantidad_bloqueada FROM products WHERE codigo='ORD-001' AND empresa_id=$1`,
      [ireId],
    );
    expect(despues[0].cantidad_bloqueada).toBe(antes[0].cantidad_bloqueada);
    const libera = await t.dataSource.query(
      `SELECT tipo, cantidad_bloqueada_delta FROM inventory_movements
       WHERE doc_tipo='PEDIDO' AND doc_id=$1 AND tipo='LIBERACION_BLOQUEO'`,
      [id],
    );
    expect(libera).toHaveLength(1);
    expect(libera[0].cantidad_bloqueada_delta).toBe(-2);

    // Pedido cancelado no admite más operaciones
    const scan = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7501001' });
    expect(scan.status).toBe(400);
  });

  it('HU-028 (Excel): crea pedido desde archivo con Referencia/Cantidad', async () => {
    const ws = XLSX.utils.json_to_sheet([
      { Referencia: 'ORD-001', Cantidad: 1 },
      { Referencia: 'ORD-003', Cantidad: 2 },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Pedido');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const res = await t.http
      .post('/api/v1/orders/excel')
      .set('Authorization', `Bearer ${comercialToken}`)
      .field('empresaId', ireId)
      .field('clienteId', clienteId)
      .attach('file', buffer, {
        filename: 'pedido.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.comercialId).toBe(comercialId); // automático
    expect(res.body.estado).toBe('ABIERTO');
  });

  it('RBAC negativo: escaneo solo Operador; factura/cancelación solo Generador', async () => {
    const pedido = await crearPedido([{ referencia: 'ORD-001', cantidad: 1 }]);
    const id = pedido.body.id;

    const scanGen = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7501001' });
    expect(scanGen.status).toBe(403);
    const scanCom = await t.http
      .post(`/api/v1/orders/${id}/scan`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({ modo: 'COMPLETO', codigo: '7501001' });
    expect(scanCom.status).toBe(403);

    const invOp = await t.http
      .post(`/api/v1/orders/${id}/invoice`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ocrDocumentId: '00000000-0000-0000-0000-000000000000' });
    expect(invOp.status).toBe(403);
    const cancelOp = await t.http
      .post(`/api/v1/orders/${id}/cancel`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    expect(cancelOp.status).toBe(403);
    const cancelCom = await t.http
      .post(`/api/v1/orders/${id}/cancel`)
      .set('Authorization', `Bearer ${comercialToken}`)
      .send({});
    expect(cancelCom.status).toBe(403);
  });
});
