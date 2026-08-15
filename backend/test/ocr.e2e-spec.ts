import { readFileSync } from 'fs';
import { join } from 'path';
import { OcrLlmStrategy } from '../src/modules/ocr/strategies/ocr-llm.strategy';
import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

const FIXTURES = join(__dirname, 'fixtures');
const PNG = readFileSync(join(FIXTURES, 'factura-ocr.png'));
const PDF = readFileSync(join(FIXTURES, 'factura-ocr.pdf'));

/** Respuesta LLM simulada (OpenAI-compatible) con datos de la factura. */
const LLM_JSON = {
  numeroFactura: 'INV-LLM-0099',
  fecha: '2026-07-20',
  proveedor: 'LLM PARTS CO',
  cliente: null,
  direccion: null,
  numeroGuia: null,
  transportadora: null,
  items: [{ referencia: 'LLM-1', descripcion: 'SENSOR', cantidad: 4, unidad: 'UND' }],
};

let llmStrategy: OcrLlmStrategy;

function mockLlmOk() {
  llmStrategy.fetchFn = (async () =>
    ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify(LLM_JSON) } }],
      }),
      text: async () => '',
    }) as any) as any;
}

function mockLlmFalla() {
  llmStrategy.fetchFn = (async () => {
    throw new Error('connection refused');
  }) as any;
}

/**
 * I5 — EP-05/M13: OCR configurable.
 * HU-019: proveedores LLM (un solo activo, key enmascarada).
 * HU-020: selección de motor activo (auditada, precondición proveedor activo).
 * HU-018/HU-021: procesamiento con OCR local real (tesseract) y LLM mockeado;
 * vista editable, corrección manual, confirmación; temporales eliminables,
 * facturas permanentes (M13). CU-009: falla LLM → contingencia a OCR local.
 */
describe('OCR configurable (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    llmStrategy = t.app.get(OcrLlmStrategy);
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    for (const [username, rol] of [
      ['generador.i5', 'GENERADOR'],
      ['operador.i5', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i5', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i5', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterEach(() => {
    llmStrategy.fetchFn = undefined;
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-019: registra proveedores con key enmascarada; solo uno queda activo', async () => {
    const p1 = await t.http
      .post('/api/v1/ocr-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ proveedor: 'OPENAI', nombre: 'OpenAI Corp', modelo: 'gpt-4o-mini', apiKey: 'sk-test-abcdefghij', prioridad: 1 });
    expect(p1.status).toBe(201);
    expect(p1.body.apiKey).toBeUndefined();
    expect(p1.body.apiKeyMasked).toBe('••••••••ghij');
    expect(p1.body.estado).toBe('INACTIVO');

    const p2 = await t.http
      .post('/api/v1/ocr-providers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ proveedor: 'GEMINI', nombre: 'Gemini Corp', modelo: 'gemini-2.0-flash', apiKey: 'gm-123456789xyz', prioridad: 2 });
    expect(p2.status).toBe(201);

    // Activar p1 → p1 ACTIVO, p2 INACTIVO
    const act1 = await t.http
      .post(`/api/v1/ocr-providers/${p1.body.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(act1.status).toBe(201);
    expect(act1.body.estado).toBe('ACTIVO');

    // Activar p2 → p2 ACTIVO y p1 pasa a INACTIVO (M13: solo un activo)
    await t.http
      .post(`/api/v1/ocr-providers/${p2.body.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    const lista = await t.http
      .get('/api/v1/ocr-providers')
      .set('Authorization', `Bearer ${adminToken}`);
    const activos = lista.body.filter((p: any) => p.estado === 'ACTIVO');
    expect(activos).toHaveLength(1);
    expect(activos[0].id).toBe(p2.body.id);
    expect(lista.body.every((p: any) => p.apiKey === undefined)).toBe(true);

    // No se puede eliminar el proveedor activo
    const del = await t.http
      .delete(`/api/v1/ocr-providers/${p2.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(400);
  });

  it('HU-020: OCR_LLM exige proveedor activo; el cambio de motor queda auditado', async () => {
    // Desactivar el proveedor activo → seleccionar OCR_LLM debe fallar
    const lista = await t.http
      .get('/api/v1/ocr-providers')
      .set('Authorization', `Bearer ${adminToken}`);
    const activo = lista.body.find((p: any) => p.estado === 'ACTIVO');
    await t.http
      .post(`/api/v1/ocr-providers/${activo.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);

    const sinProvider = await t.http
      .post('/api/v1/ocr/engine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ engine: 'OCR_LLM' });
    expect(sinProvider.status).toBe(400);
    expect(sinProvider.body.message).toContain('proveedor LLM activo');

    // Reactivar y seleccionar OCR_LLM
    await t.http
      .post(`/api/v1/ocr-providers/${activo.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    const ok = await t.http
      .post('/api/v1/ocr/engine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ engine: 'OCR_LLM', motivo: 'Prueba HU-020' });
    expect(ok.status).toBe(201);
    expect(ok.body.engine).toBe('OCR_LLM');

    // Auditado
    const logs = await t.dataSource.query(
      `SELECT accion, valor_nuevo FROM audit_logs WHERE tabla='system_params' AND registro_id='ocr.active_engine' ORDER BY fecha_hora DESC LIMIT 1`,
    );
    expect(logs[0].valor_nuevo.engine).toBe('OCR_LLM');
  });

  it('HU-021: procesa PDF con OCR LLM (mockeado) y queda en estado Creado', async () => {
    // El mock responde en formato OpenAI: activar el proveedor OPENAI
    const lista = await t.http
      .get('/api/v1/ocr-providers')
      .set('Authorization', `Bearer ${adminToken}`);
    const openai = lista.body.find((p: any) => p.proveedor === 'OPENAI');
    await t.http
      .post(`/api/v1/ocr-providers/${openai.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    mockLlmOk();
    const res = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_IMPORTACION')
      .attach('file', PDF, { filename: 'factura.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('CREADO');
    expect(res.body.motor).toBe('OCR_LLM');
    expect(res.body.datosExtraidos.numeroFactura).toBe('INV-LLM-0099');
    expect(res.body.datosExtraidos.items).toHaveLength(1);

    // La factura de importación se almacena permanente (M13)
    const doc = await t.dataSource.query(
      `SELECT es_temporal FROM documents WHERE id=$1`,
      [res.body.documentId],
    );
    expect(doc[0].es_temporal).toBe(false);
  });

  it('I22: el LLM que responde con alias en inglés o números formateados NO devuelve null', async () => {
    // Respuesta típica de un modelo que "traduce" el esquema (la causa de
    // los campos null reportados): claves en inglés y montos como texto
    llmStrategy.fetchFn = (async () =>
      ({
        ok: true,
        json: async () => ({
          choices: [{
            message: {
              content: '```json\n' + JSON.stringify({
                invoice_number: 'FEIR10022',
                date: '2026-08-14',
                customer: 'REPUESTOS AUDIVAG S.A.S',
                tax_id: '901529974',
                address: 'CR 27A 67 15',
                total_amount: '429.352',
                line_items: [{
                  sku: 'MCEVW1000MY',
                  description: 'ESPIRAL DEL GOL SAVEIRO',
                  quantity: 4,
                  unit_price: '110.000',
                  line_total: '440.000',
                }],
              }) + '\n```',
            },
          }],
        }),
        text: async () => '',
      }) as any) as any;

    const lista = await t.http
      .get('/api/v1/ocr-providers')
      .set('Authorization', `Bearer ${adminToken}`);
    const openai = lista.body.find((p: any) => p.proveedor === 'OPENAI');
    await t.http
      .post(`/api/v1/ocr-providers/${openai.id}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    await t.http
      .post('/api/v1/ocr/engine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ engine: 'OCR_LLM' });

    const res = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_VENTA')
      .attach('file', PDF, { filename: 'FEIR10022.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const d = res.body.datosExtraidos;
    expect(d.numeroFactura).toBe('FEIR10022');
    expect(d.fecha).toBe('2026-08-14');
    expect(d.cliente).toBe('REPUESTOS AUDIVAG S.A.S');
    expect(d.direccion).toBe('CR 27A 67 15');
    expect(d.total).toBe(429352);
    expect(d.items).toHaveLength(1);
    expect(d.items[0].referencia).toBe('MCEVW1000MY');
    expect(d.items[0].cantidad).toBe(4);
    expect(d.items[0].valorUnitario).toBe(110000);
    expect(d.items[0].valorTotal).toBe(440000);
  });

  it('CU-009: falla del LLM → error explícito y contingencia a OCR local', async () => {
    mockLlmFalla();
    const res = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_IMPORTACION')
      .attach('file', PDF, { filename: 'factura.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(503);
    expect(res.body.message).toContain('OCR_LOCAL');

    // El Administrador cambia a OCR local (contingencia, M13)
    llmStrategy.fetchFn = undefined;
    const engine = await t.http
      .post('/api/v1/ocr/engine')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ engine: 'OCR_LOCAL' });
    expect(engine.status).toBe(201);
  });

  it('HU-018/HU-021: OCR local real (tesseract) extrae datos de imagen y PDF', async () => {
    // Prueba de procesamiento (admin) sin persistir
    const test = await t.http
      .post('/api/v1/ocr/test')
      .set('Authorization', `Bearer ${adminToken}`)
      .field('tipoDocumento', 'FACTURA_IMPORTACION')
      .attach('file', PNG, { filename: 'factura.png', contentType: 'image/png' });
    expect(test.status).toBe(201);
    expect(test.body.motor).toBe('OCR_LOCAL');
    expect(test.body.datos.numeroFactura).toBe('INV-2026-0042');
    expect(test.body.confianza).toBeGreaterThan(0.5);

    // Procesamiento real con imagen
    const res = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_IMPORTACION')
      .attach('file', PNG, { filename: 'factura.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.motor).toBe('OCR_LOCAL');
    const datos = res.body.datosExtraidos;
    expect(datos.numeroFactura).toBe('INV-2026-0042');
    expect(datos.fecha).toBe('2026-07-15');
    expect(datos.proveedor).toBe('ACME PARTS LLC');
    expect(datos.items.length).toBe(2);
    expect(datos.items[0].referencia).toBe('REF-1001');
    expect(datos.items[0].cantidad).toBe(10);

    // PDF con texto embebido también funciona con el motor local
    const resPdf = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'ORDEN_PEDIDO')
      .attach('file', PDF, { filename: 'orden.pdf', contentType: 'application/pdf' });
    expect(resPdf.status).toBe(201);
    expect(resPdf.body.datosExtraidos.items.length).toBe(2);
  });

  it('HU-021: corrección manual → confirmación; temporales eliminables, permanentes no (M13)', async () => {
    // Orden de pedido (temporal)
    const res = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'ORDEN_PEDIDO')
      .attach('file', PNG, { filename: 'orden.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    const id = res.body.id;

    // No se puede eliminar antes de confirmar
    const delAntes = await t.http
      .delete(`/api/v1/ocr/documents/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(delAntes.status).toBe(400);

    // Corrección manual de los datos extraídos
    const corregidos = {
      ...res.body.datosExtraidos,
      cliente: 'Autorepuestos del Norte SA',
      items: [{ referencia: 'REF-1001', descripcion: 'OIL FILTER', cantidad: 12, unidad: 'UND' }],
    };
    const patch = await t.http
      .patch(`/api/v1/ocr/documents/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ datosExtraidos: corregidos });
    expect(patch.status).toBe(200);
    expect(patch.body.datosExtraidos.cliente).toBe('Autorepuestos del Norte SA');
    expect(patch.body.datosExtraidos.items[0].cantidad).toBe(12);

    // Confirmar
    const conf = await t.http
      .post(`/api/v1/ocr/documents/${id}/confirm`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(conf.status).toBe(201);
    expect(conf.body.estado).toBe('CONFIRMADO');

    // No se puede corregir tras confirmar
    const patchDespues = await t.http
      .patch(`/api/v1/ocr/documents/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ datosExtraidos: corregidos });
    expect(patchDespues.status).toBe(400);

    // Temporal confirmado → se puede eliminar
    const del = await t.http
      .delete(`/api/v1/ocr/documents/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(del.status).toBe(200);

    // Factura de importación (permanente): no se elimina ni confirmada
    const fact = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${generadorToken}`)
      .field('tipoDocumento', 'FACTURA_IMPORTACION')
      .attach('file', PNG, { filename: 'factura.png', contentType: 'image/png' });
    await t.http
      .post(`/api/v1/ocr/documents/${fact.body.id}/confirm`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const delFact = await t.http
      .delete(`/api/v1/ocr/documents/${fact.body.id}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(delFact.status).toBe(400);
    expect(delFact.body.message).toContain('permanentes');
  });

  it('RBAC negativo: Operador recibe 403 en procesamiento y proveedores', async () => {
    const proc = await t.http
      .post('/api/v1/ocr/documents')
      .set('Authorization', `Bearer ${operadorToken}`)
      .field('tipoDocumento', 'ORDEN_PEDIDO')
      .attach('file', PNG, { filename: 'orden.png', contentType: 'image/png' });
    expect(proc.status).toBe(403);

    const prov = await t.http
      .get('/api/v1/ocr-providers')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(prov.status).toBe(403);

    const engine = await t.http
      .post('/api/v1/ocr/engine')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ engine: 'OCR_LOCAL' });
    expect(engine.status).toBe(403);
  });
});
