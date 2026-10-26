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

const PNG_FACTURA = readFileSync(join(__dirname, 'fixtures', 'factura-venta.png'));

/**
 * I60: la factura de venta emitida por World Office trunca el código del
 * producto; el cruce tolerante (mayor cantidad de letras del código + parte
 * del nombre) permite aprobar el pedido cuando el producto es el correcto.
 * I61: el Administrador ajusta los precios del pedido en cualquier estado.
 */
describe('Pedidos — factura con códigos truncados (I60) y ajuste de precios (I61) (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let clienteId: string;
  let comercialId: string;

  async function crearProducto(
    codigo: string,
    cantidad: number,
    descripcion: string,
    barcode?: string,
  ) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo,
        descripcion,
        unidadMedida: 'UND',
        precio: 5000,
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

  async function crearPedido(items: any[]) {
    const res = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, clienteId, comercialId, items });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function alistarCompleto(orderId: string, codigo: string, cantidad: number) {
    const r = await t.http
      .post(`/api/v1/orders/${orderId}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo, cantidad });
    expect(r.status).toBe(201);
    const fin = await t.http
      .post(`/api/v1/orders/${orderId}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.body.estado).toBe('ALISTADO');
  }

  /** Procesa la fixture y corrige los datos extraídos (simula la factura WO). */
  async function ocrFacturaWo(items: any[]) {
    const ocr = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_VENTA')
      .attach('file', PNG_FACTURA, { filename: 'fv.png', contentType: 'image/png' });
    expect(ocr.status).toBe(201);
    const datos = { ...ocr.body.datosExtraidos, items, numeroFactura: 'FV-WO-0001' };
    const corregido = await t.http
      .patch(`/api/v1/ocr/documents/${ocr.body.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ datosExtraidos: datos });
    expect(corregido.status).toBe(200);
    return ocr.body.id as string;
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
      .send({ nombre: 'Refacciones WO', identificacion: '901555666', ciudad: 'Cali', direccion: 'Av 1 # 2-3' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial WO', identificacion: 'C-WO1' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    for (const [username, rol] of [
      ['generador.wo', 'GENERADOR'],
      ['operador.wo', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.wo', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.wo', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('I60: código truncado único en la factura aprueba el pedido (cruce parcial)', async () => {
    await crearProducto('WOTRUNCADO-001', 10, 'FILTRO AIRE CABINA CARBON', '7599001');
    const pedido = await crearPedido([{ referencia: 'WOTRUNCADO-001', cantidad: 2 }]);
    await alistarCompleto(pedido.id, '7599001', 2);

    // WO trunca el código a 7 letras en la factura
    const ocrId = await ocrFacturaWo([
      { referencia: 'WOTRUNC', descripcion: 'FILTRO AIRE CABINA CARBON', cantidad: 2 },
    ]);
    const aprob = await t.http
      .post(`/api/v1/orders/${pedido.id}/invoice`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrId });
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');
    expect(aprob.body.numeroFactura).toBe('FV-WO-0001');

    // El cruce parcial quedó en auditoría
    const aud = await t.dataSource.query(
      `SELECT valor_nuevo FROM audit_logs WHERE tabla='Pedidos' AND registro_id=$1 AND accion='PEDIDO_APROBADO'`,
      [pedido.id],
    );
    expect(aud[0].valor_nuevo.crucesParciales).toEqual([
      { referencia: 'WOTRUNC', codigo: 'WOTRUNCADO-001', criterio: 'CODIGO_PARCIAL' },
    ]);
  });

  it('I60: prefijo ambiguo desempata comparando parte del nombre', async () => {
    await crearProducto('DESA-111', 5, 'BUJE HORQUILLA SUPERIOR', '7599111');
    await crearProducto('DESA-222', 5, 'TACO MOTOR TRASERO', '7599222');
    const pedido = await crearPedido([{ referencia: 'DESA-222', cantidad: 1 }]);
    await alistarCompleto(pedido.id, '7599222', 1);

    const ocrId = await ocrFacturaWo([
      { referencia: 'DESA', descripcion: 'TACO MOTOR TRASERO REFORZADO', cantidad: 1 },
    ]);
    const aprob = await t.http
      .post(`/api/v1/orders/${pedido.id}/invoice`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrId });
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');

    // Sin pista de nombre el prefijo ambiguo NO adivina: sigue rechazando
    const pedido2 = await crearPedido([{ referencia: 'DESA-111', cantidad: 1 }]);
    await alistarCompleto(pedido2.id, '7599111', 1);
    const ocrId2 = await ocrFacturaWo([
      { referencia: 'DESA', descripcion: 'SIN PISTA DEL NOMBRE', cantidad: 1 },
    ]);
    const rechazo = await t.http
      .post(`/api/v1/orders/${pedido2.id}/invoice`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ ocrDocumentId: ocrId2 });
    expect(rechazo.status).toBe(400);
    expect(rechazo.body.code).toBe('FACTURA_CON_DIFERENCIAS');
  });

  it('I61: el Administrador ajusta precios en cualquier estado; otros roles no', async () => {
    const pedido = await crearPedido([
      { referencia: 'WOTRUNCADO-001', cantidad: 3, valorUnidad: 5000 },
    ]);
    const itemId = pedido.items[0].id;

    // Estado ABIERTO
    const ajuste1 = await t.http
      .patch(`/api/v1/orders/${pedido.id}/precios`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ itemId, valorUnidad: 4800 }] });
    expect(ajuste1.status).toBe(200);
    expect(Number(ajuste1.body.items[0].valorUnidad)).toBe(4800);
    expect(Number(ajuste1.body.items[0].valorTotal)).toBe(14400);

    // Estado ALISTADO
    await alistarCompleto(pedido.id, '7599001', 3);
    const ajuste2 = await t.http
      .patch(`/api/v1/orders/${pedido.id}/precios`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ itemId, valorUnidad: 5100 }] });
    expect(ajuste2.status).toBe(200);
    expect(Number(ajuste2.body.items[0].valorTotal)).toBe(15300);
    expect(ajuste2.body.estado).toBe('ALISTADO'); // el estado no cambia

    // Otros roles: prohibido
    for (const token of [generadorToken, operadorToken]) {
      const prohibido = await t.http
        .patch(`/api/v1/orders/${pedido.id}/precios`)
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ itemId, valorUnidad: 1 }] });
      expect(prohibido.status).toBe(403);
    }

    // Ítem de otro pedido: 400
    const otro = await crearPedido([{ referencia: 'DESA-111', cantidad: 1 }]);
    const cruzado = await t.http
      .patch(`/api/v1/orders/${pedido.id}/precios`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ items: [{ itemId: otro.items[0].id, valorUnidad: 100 }] });
    expect(cruzado.status).toBe(400);

    // Auditoría con antes/después
    const aud = await t.dataSource.query(
      `SELECT accion, valor_anterior, valor_nuevo FROM audit_logs
       WHERE tabla='Pedidos' AND registro_id=$1 AND accion='PEDIDO_PRECIOS_AJUSTADOS' ORDER BY fecha_hora`,
      [pedido.id],
    );
    expect(aud).toHaveLength(2);
    expect(aud[0].valor_anterior.precios[0]).toEqual({ codigo: 'WOTRUNCADO-001', valor: 5000 });
    expect(aud[0].valor_nuevo.precios[0]).toEqual({ codigo: 'WOTRUNCADO-001', valor: 4800 });
    expect(aud[1].valor_anterior.estado).toBe('ALISTADO');
  });
});
