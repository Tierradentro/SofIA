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

const PNG = readFileSync(join(__dirname, 'fixtures', 'factura-ocr.png'));

/**
 * I6 — EP-06/M07: ingreso de mercancía.
 * HU-022 (factura OCR o manual), HU-023 (caja principal), HU-024/027
 * (cantidades y completar parcial), HU-025 (alertas/bloqueo por diferencias),
 * HU-026 (aprobación con observación), CU-001 (producto nuevo automático).
 */
describe('Ingreso de mercancía (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;

  async function crearProducto(codigo: string, extra: any = {}) {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo,
        descripcion: `Producto ${codigo}`,
        unidadMedida: 'UND',
        precio: 1000,
        ...extra,
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function crearIngreso(items: any[], extra: any = {}) {
    const res = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        numeroFactura: 'FAC-TEST-1',
        proveedor: 'Proveedor Test',
        items,
        ...extra,
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function flujoRecepcion(id: string, cantidades: Record<string, number>) {
    await t.http.post(`/api/v1/inbound/${id}/iniciar`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/inbound/${id}/caja`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigoCaja: 'CAJA-MADRE-001' });
    const det = await t.http.get(`/api/v1/inbound/${id}`).set('Authorization', `Bearer ${operadorToken}`);
    for (const item of det.body.items) {
      const cant = cantidades[item.referencia] ?? item.cantidadFacturada;
      const r = await t.http
        .put(`/api/v1/inbound/${id}/items/${item.id}/cantidad`)
        .set('Authorization', `Bearer ${operadorToken}`)
        .send({ cantidadRecibida: cant });
      expect(r.status).toBe(200);
    }
    return t.http
      .post(`/api/v1/inbound/${id}/cerrar-conteo`)
      .set('Authorization', `Bearer ${operadorToken}`);
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    [ireId] = (
      await t.dataSource.query(`SELECT id FROM companies WHERE nombre='IRE'`)
    ).map((r: any) => r.id);
    for (const [username, rol] of [
      ['generador.i6', 'GENERADOR'],
      ['operador.i6', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i6', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i6', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('Flujo completo sin diferencias: CREADO → EN_INGRESO → APROBADO con movimientos', async () => {
    await crearProducto('ING-001');
    await crearProducto('ING-002');
    const ingreso = await crearIngreso([
      { referencia: 'ING-001', descripcion: 'Filtro', cantidadFacturada: 10 },
      { referencia: 'ING-002', descripcion: 'Pastillas', cantidadFacturada: 5 },
    ]);
    expect(ingreso.estado).toBe('CREADO');
    expect(ingreso.items.every((i: any) => i.esNuevo === false && i.productId)).toBe(true);

    // Aprobar sin caja principal → 400 (HU-023)
    await t.http.post(`/api/v1/inbound/${ingreso.id}/iniciar`).set('Authorization', `Bearer ${operadorToken}`);
    const sinCaja = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(sinCaja.status).toBe(400);
    expect(sinCaja.body.message).toContain('caja principal');

    const cierre = await flujoRecepcion(ingreso.id, {});
    expect(cierre.body.estado).toBe('EN_INGRESO'); // sin diferencias
    expect(cierre.body.resumen.coincidencias).toBe(2);

    // Aprobar sin conteo cerrado está cubierto por el cierre previo; ahora sí aprueba
    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');

    // Stock actualizado por movimientos INGRESO_APROBADO
    const movs = await t.dataSource.query(
      `SELECT tipo, cantidad_delta FROM inventory_movements WHERE doc_tipo='INGRESO' AND doc_id=$1 ORDER BY id`,
      [ingreso.id],
    );
    expect(movs).toHaveLength(2);
    expect(movs.every((m: any) => m.tipo === 'INGRESO_APROBADO')).toBe(true);
    const p1 = await t.dataSource.query(`SELECT cantidad FROM products WHERE codigo='ING-001' AND empresa_id=$1`, [ireId]);
    const p2 = await t.dataSource.query(`SELECT cantidad FROM products WHERE codigo='ING-002' AND empresa_id=$1`, [ireId]);
    expect(p1[0].cantidad).toBe(10);
    expect(p2[0].cantidad).toBe(5);
  });

  it('HU-025/026: diferencias bloquean el cierre (Pendiente_Corrección) y exigen observación', async () => {
    await crearProducto('ING-010');
    const ingreso = await crearIngreso([
      { referencia: 'ING-010', descripcion: 'Amortiguador', cantidadFacturada: 10 },
    ]);
    const cierre = await flujoRecepcion(ingreso.id, { 'ING-010': 7 });
    expect(cierre.body.estado).toBe('PENDIENTE_CORRECCION');
    expect(cierre.body.resumen.faltantes).toBe(1);

    // Aprobar sin observación → 400 (HU-026)
    const sinObs = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(sinObs.status).toBe(400);
    expect(sinObs.body.message).toContain('observación');

    // Con observación → APROBADO, entra lo recibido (7)
    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ observacion: 'Faltan 3 unidades, proveedor notificado' });
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');
    expect(aprob.body.observacionDiferencias).toContain('Faltan 3');
    const p = await t.dataSource.query(`SELECT cantidad FROM products WHERE codigo='ING-010' AND empresa_id=$1`, [ireId]);
    expect(p[0].cantidad).toBe(7);
  });

  it('CU-001: producto nuevo se crea automáticamente al aprobar y bloquea en Pendiente_Corrección', async () => {
    const ingreso = await crearIngreso([
      { referencia: 'NUEVO-500', descripcion: 'Sensor nuevo', cantidadFacturada: 4 },
    ]);
    expect(ingreso.items[0].esNuevo).toBe(true);
    expect(ingreso.items[0].productId).toBeNull();

    const cierre = await flujoRecepcion(ingreso.id, { 'NUEVO-500': 4 });
    expect(cierre.body.estado).toBe('PENDIENTE_CORRECCION');
    expect(cierre.body.resumen.nuevos).toBe(1);

    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ observacion: 'Producto nuevo aprobado, atributos pendientes' });
    expect(aprob.status).toBe(201);

    // Producto creado automáticamente con stock recibido y ubicación pendiente
    const p = await t.dataSource.query(
      `SELECT cantidad, ubicacion, observaciones FROM products WHERE codigo='NUEVO-500' AND empresa_id=$1`,
      [ireId],
    );
    expect(p).toHaveLength(1);
    expect(p[0].cantidad).toBe(4);
    expect(p[0].ubicacion).toBeNull();
    expect(p[0].observaciones).toContain('Creado automáticamente');
    // Auditado en la tabla Productos (regla transversal)
    const audit = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE tabla='Productos' AND registro_id=(SELECT id::text FROM products WHERE codigo='NUEVO-500' AND empresa_id=$1)`,
      [ireId],
    );
    expect(audit[0].accion).toBe('CREAR');
  });

  it('HU-027: ingreso parcial se completa después y recalcula diferencias', async () => {
    await crearProducto('ING-020');
    const ingreso = await crearIngreso([
      { referencia: 'ING-020', descripcion: 'Batería', cantidadFacturada: 10 },
    ]);
    const cierre = await flujoRecepcion(ingreso.id, { 'ING-020': 6 });
    expect(cierre.body.estado).toBe('PENDIENTE_CORRECCION');

    // Llega el faltante: el Operador registra las 4 restantes
    const det = await t.http.get(`/api/v1/inbound/${ingreso.id}`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .put(`/api/v1/inbound/${ingreso.id}/items/${det.body.items[0].id}/cantidad`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ cantidadRecibida: 10 });
    const cierre2 = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/cerrar-conteo`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(cierre2.body.estado).toBe('EN_INGRESO');
    expect(cierre2.body.resumen.coincidencias).toBe(1);

    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(aprob.status).toBe(201);
    const p = await t.dataSource.query(`SELECT cantidad FROM products WHERE codigo='ING-020' AND empresa_id=$1`, [ireId]);
    expect(p[0].cantidad).toBe(10);
  });

  it('HU-022: crea el ingreso desde la factura procesada por OCR', async () => {
    await crearProducto('REF-1001');
    await crearProducto('REF-1002');
    // Procesar la factura con OCR local (motor por defecto del seed)
    const ocr = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_IMPORTACION')
      .attach('file', PNG, { filename: 'factura.png', contentType: 'image/png' });
    expect(ocr.status).toBe(201);

    const ingreso = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, ocrDocumentId: ocr.body.id });
    expect(ingreso.status).toBe(201);
    expect(ingreso.body.numeroFactura).toBe('INV-2026-0042');
    expect(ingreso.body.proveedor).toBe('ACME PARTS LLC');
    expect(ingreso.body.items).toHaveLength(2);
    expect(ingreso.body.items.every((i: any) => i.productId && !i.esNuevo)).toBe(true);

    const cierre = await flujoRecepcion(ingreso.body.id, {});
    expect(cierre.body.resumen.coincidencias).toBe(2);
    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(aprob.status).toBe(201);
    const p = await t.dataSource.query(`SELECT cantidad FROM products WHERE codigo='REF-1001' AND empresa_id=$1`, [ireId]);
    expect(p[0].cantidad).toBe(10);
  });

  it('Cancelación: el Generador cancela en cualquier momento; aprobado no cancela', async () => {
    await crearProducto('ING-030');
    const ingreso = await crearIngreso([
      { referencia: 'ING-030', descripcion: 'Cadena', cantidadFacturada: 2 },
    ]);
    const cancel = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/cancel`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'Factura errada' });
    expect(cancel.status).toBe(201);
    expect(cancel.body.estado).toBe('CANCELADO');

    const aprobarCancelado = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(aprobarCancelado.status).toBe(400);

    // Un ingreso aprobado no se puede cancelar
    const ingreso2 = await crearIngreso([
      { referencia: 'ING-030', descripcion: 'Cadena', cantidadFacturada: 2 },
    ]);
    await flujoRecepcion(ingreso2.id, {});
    await t.http
      .post(`/api/v1/inbound/${ingreso2.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    const cancelAprobado = await t.http
      .post(`/api/v1/inbound/${ingreso2.id}/cancel`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ motivo: 'tarde' });
    expect(cancelAprobado.status).toBe(400);
  });

  it('RBAC negativo: Operador no crea/aprueba/cancela; Generador no opera la recepción', async () => {
    const crearOp = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ empresaId: ireId, items: [{ referencia: 'X', cantidadFacturada: 1 }] });
    expect(crearOp.status).toBe(403);

    const ingreso = await crearIngreso([
      { referencia: 'ING-040', descripcion: 'Kit', cantidadFacturada: 1 },
    ]);
    const aprobarOp = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/approve`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    expect(aprobarOp.status).toBe(403);
    const cancelOp = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/cancel`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({});
    expect(cancelOp.status).toBe(403);

    const iniciarGen = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/iniciar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(iniciarGen.status).toBe(403);
    const cajaGen = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/caja`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ codigoCaja: 'X' });
    expect(cajaGen.status).toBe(403);
    const conteoGen = await t.http
      .post(`/api/v1/inbound/${ingreso.id}/cerrar-conteo`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(conteoGen.status).toBe(403);
  });
});
