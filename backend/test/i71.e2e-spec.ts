import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I71 — ingreso de mercancía con el formato de factura de compra FC 1241:
 * - La factura trae la empresa emisora (nombre/NIT): si no corresponde a la
 *   empresa del ingreso, se rechaza con mensaje claro.
 * - El número de factura queda en la trazabilidad de la actividad.
 * - Las cantidades con decimales se truncan (solo el entero).
 * - El cruce de productos usa el matcher tolerante de pedidos (código
 *   truncado, descripción aproximada) además del exacto.
 * - La verificación del Operador es OPCIONAL: el Generador (o el
 *   Administrador) aprueba por el total facturado directamente desde
 *   CREADO; las cantidades SUMAN a las existencias.
 * - El producto nuevo queda marcado con ficha técnica pendiente y, con la
 *   marca, su ficha permite editar todos los campos (incluido el código).
 */
describe('I71 — ingreso de mercancía por factura de compra (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let icvId: string;

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

  /** Inserta un documento OCR de factura de compra ya procesado. */
  async function insertarFacturaCompra(datos: any): Promise<string> {
    const admin = await t.dataSource.query(`SELECT id FROM users WHERE username='Admin'`);
    const doc = await t.dataSource.query(
      `INSERT INTO documents (owner_type, owner_id, tipo, path, nombre_original, mime, size, es_temporal, created_by)
       VALUES ('ocr', NULL, 'FACTURA_IMPORTACION', $1, $2, 'application/pdf', 0, true, $3) RETURNING id`,
      [`test/fc-${Date.now()}.pdf`, 'fc.pdf', admin[0].id],
    );
    const ocr = await t.dataSource.query(
      `INSERT INTO ocr_documents (document_id, tipo_documento, motor, estado, datos_extraidos, empresa_id, created_by)
       VALUES ($1, 'FACTURA_IMPORTACION', 'OCR_LOCAL', 'CONFIRMADO', $2, $3, $4) RETURNING id`,
      [doc[0].id, JSON.stringify(datos), ireId, admin[0].id],
    );
    return ocr[0].id as string;
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    const empresas = await t.dataSource.query(
      `SELECT id, nombre FROM companies WHERE nombre IN ('IRE','ICV')`,
    );
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;
    icvId = empresas.find((e: any) => e.nombre === 'ICV').id;
    // NIT de la empresa IRE (el que trae la factura FC 1241 en su encabezado)
    await t.dataSource.query(
      `UPDATE companies SET identificacion='900349362-8' WHERE id=$1`,
      [ireId],
    );
    for (const [username, rol] of [
      ['generador.i71', 'GENERADOR'],
      ['operador.i71', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i71', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i71', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('rechaza el ingreso si la empresa de la factura es diferente (NIT y siglas)', async () => {
    const datos = {
      numeroFactura: '1241',
      fecha: '2026-11-11',
      proveedor: 'FRAS-LE PANAMERICANA S.A.S',
      empresaFactura: 'IMPORT - REPUESTOS EL ESCARABAJO S A S',
      nitEmpresa: '900349362',
      items: [{ referencia: 'NBJ1011DP', descripcion: 'TIJERA DER NVO GOL', cantidad: 5, unidad: 'UND' }],
    };
    // Por NIT: la factura es de IRE (identificacion 900349362-8)
    const ocrId = await insertarFacturaCompra(datos);
    const erra = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: icvId, ocrDocumentId: ocrId });
    expect(erra.status).toBe(400);
    expect(erra.body.message).toContain('IRE');
    expect(erra.body.message).toContain('1241');

    // Por siglas del nombre cuando no hay NIT que cruzar
    const ocrSinNit = await insertarFacturaCompra({ ...datos, nitEmpresa: null });
    const erra2 = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: icvId, ocrDocumentId: ocrSinNit });
    expect(erra2.status).toBe(400);
    expect(erra2.body.message).toContain('IRE');

    // Empresa correcta → se crea y el número de factura queda en la actividad
    const ok = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, ocrDocumentId: ocrId });
    expect(ok.status).toBe(201);
    expect(ok.body.numeroFactura).toBe('1241');
    expect(ok.body.fechaFactura).toBe('2026-11-11');
    expect(ok.body.proveedor).toBe('FRAS-LE PANAMERICANA S.A.S');
    // Trazabilidad: el número de factura queda en la auditoría de creación
    const audit = await t.dataSource.query(
      `SELECT valor_nuevo FROM audit_logs WHERE accion='INGRESO_CREADO' AND registro_id=$1`,
      [ok.body.id],
    );
    expect(audit[0].valor_nuevo.numeroFactura).toBe('1241');
  });

  it('aprueba desde CREADO por el total facturado y SUMA a las existencias', async () => {
    await crearProducto('I71-A');
    const ingreso = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        numeroFactura: 'FC-100',
        proveedor: 'Proveedor I71',
        items: [{ referencia: 'I71-A', descripcion: 'Filtro I71', cantidadFacturada: 5 }],
      });
    expect(ingreso.status).toBe(201);
    expect(ingreso.body.estado).toBe('CREADO');

    // Sin iniciar, sin caja y sin conteo: el Generador da el ingreso por el total
    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(aprob.status).toBe(201);
    expect(aprob.body.estado).toBe('APROBADO');
    expect(aprob.body.items[0].cantidadRecibida).toBe(5);
    let p = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE codigo='I71-A' AND empresa_id=$1`, [ireId],
    );
    expect(p[0].cantidad).toBe(5);

    // Segundo ingreso del mismo producto, aprobado por el ADMINISTRADOR:
    // las cantidades se SUMAN a las existencias
    const ingreso2 = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        empresaId: ireId,
        numeroFactura: 'FC-101',
        items: [{ referencia: 'I71-A', descripcion: 'Filtro I71', cantidadFacturada: 3 }],
      });
    expect(ingreso2.status).toBe(201);
    const aprob2 = await t.http
      .post(`/api/v1/inbound/${ingreso2.body.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(aprob2.status).toBe(201);
    p = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE codigo='I71-A' AND empresa_id=$1`, [ireId],
    );
    expect(p[0].cantidad).toBe(8);
    // Movimientos acumulados (trazabilidad por factura)
    const movs = await t.dataSource.query(
      `SELECT doc_id, cantidad_delta FROM inventory_movements
       WHERE tipo='INGRESO_APROBADO' AND product_id=(SELECT id FROM products WHERE codigo='I71-A' AND empresa_id=$1)
       ORDER BY id`,
      [ireId],
    );
    expect(movs.map((m: any) => m.cantidad_delta)).toEqual([5, 3]);
  });

  it('la verificación del Operador sigue disponible pero es opcional', async () => {
    await crearProducto('I71-B');
    const ingreso = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        numeroFactura: 'FC-102',
        items: [{ referencia: 'I71-B', descripcion: 'Banda I71', cantidadFacturada: 7 }],
      });
    expect(ingreso.status).toBe(201);
    // Flujo verificado (opcional): Operador inicia, caja, conteo y cierre
    await t.http.post(`/api/v1/inbound/${ingreso.body.id}/iniciar`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/caja`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigoCaja: 'CAJA-I71' });
    const det = await t.http.get(`/api/v1/inbound/${ingreso.body.id}`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .put(`/api/v1/inbound/${ingreso.body.id}/items/${det.body.items[0].id}/cantidad`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ cantidadRecibida: 7 });
    const cierre = await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/cerrar-conteo`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(cierre.body.resumen.coincidencias).toBe(1);
    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(aprob.status).toBe(201);
    const p = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE codigo='I71-B' AND empresa_id=$1`, [ireId],
    );
    expect(p[0].cantidad).toBe(7);
  });

  it('cruza por código truncado y por descripción aproximada (matcher de pedidos)', async () => {
    await crearProducto('NBJ1011DP', { descripcion: 'TIJERA DER NVO GOL C/BUJES C/ROTULA' });
    await crearProducto('ROT-N111', { descripcion: 'ROTULA SUP ESC NAKATA' });

    const ingreso = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        numeroFactura: 'FC-1241',
        items: [
          // Código truncado por la factura (falta la P final)
          { referencia: 'NBJ1011D', descripcion: 'TIJERA DER NVO GOL C/BUJES C/ROTULA', cantidadFacturada: 2 },
          // Código irreconocible: cruza por la descripción aproximada
          { referencia: 'XX-0000', descripcion: 'ROTULA SUP ESC NAKATA', cantidadFacturada: 1 },
        ],
      });
    expect(ingreso.status).toBe(201);
    const [trunc, porDesc] = ingreso.body.items;
    expect(trunc.esNuevo).toBe(false);
    expect(trunc.productId).toBeTruthy();
    expect(trunc.referencia).toBe('NBJ1011D'); // conserva la referencia del documento
    expect(porDesc.esNuevo).toBe(false);
    expect(porDesc.productId).toBeTruthy();

    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(aprob.status).toBe(201);
    const p1 = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE codigo='NBJ1011DP' AND empresa_id=$1`, [ireId],
    );
    const p2 = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE codigo='ROT-N111' AND empresa_id=$1`, [ireId],
    );
    expect(p1[0].cantidad).toBe(2);
    expect(p2[0].cantidad).toBe(1);
  });

  it('el producto nuevo queda con ficha pendiente y con la marca se editan todos los campos', async () => {
    const ingreso = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        numeroFactura: 'FC-200',
        items: [{ referencia: 'SR-I71-01', descripcion: 'Sensor nuevo I71', cantidadFacturada: 4 }],
      });
    expect(ingreso.status).toBe(201);
    expect(ingreso.body.items[0].esNuevo).toBe(true);

    // Aprobación directa por el total; producto nuevo exige observación
    const sinObs = await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({});
    expect(sinObs.status).toBe(400);
    expect(sinObs.body.message).toContain('observación');

    const aprob = await t.http
      .post(`/api/v1/inbound/${ingreso.body.id}/approve`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ observacion: 'Producto nuevo: ficha técnica por completar' });
    expect(aprob.status).toBe(201);

    const creado = await t.dataSource.query(
      `SELECT id, cantidad, ficha_pendiente, observaciones FROM products WHERE codigo='SR-I71-01' AND empresa_id=$1`,
      [ireId],
    );
    expect(creado).toHaveLength(1);
    expect(creado[0].cantidad).toBe(4);
    expect(creado[0].ficha_pendiente).toBe(true);
    expect(creado[0].observaciones).toContain('Ficha técnica pendiente');

    // Con la marca se puede completar TODO: código, marca, ficha y quitarla
    const patch = await t.http
      .patch(`/api/v1/products/${creado[0].id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        codigo: 'SENS-I71-OK',
        descripcion: 'Sensor de presión I71',
        marca: 'BOSCH',
        codigoOE: 'OE-12345',
        ubicacion: 'A-01-01',
        observaciones: 'Ficha completada manualmente',
        fichaPendiente: false,
      });
    expect(patch.status).toBe(200);
    expect(patch.body.codigo).toBe('SENS-I71-OK');
    expect(patch.body.marca).toBe('BOSCH');
    expect(patch.body.fichaPendiente).toBe(false);
    const final = await t.dataSource.query(
      `SELECT codigo, ficha_pendiente FROM products WHERE id=$1`,
      [creado[0].id],
    );
    expect(final[0].codigo).toBe('SENS-I71-OK');
    expect(final[0].ficha_pendiente).toBe(false);
  });

  it('los decimales del OCR se truncan al crear la actividad', async () => {
    const ocrId = await insertarFacturaCompra({
      numeroFactura: 'FC-300',
      items: [
        { referencia: 'I71-DEC', descripcion: 'Producto decimal', cantidad: 26.9, unidad: 'UND' },
      ],
    });
    const res = await t.http
      .post('/api/v1/inbound')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, ocrDocumentId: ocrId });
    expect(res.status).toBe(201);
    expect(res.body.items[0].cantidadFacturada).toBe(26);
  });
});
