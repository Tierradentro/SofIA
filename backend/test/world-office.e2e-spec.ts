import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XLSX = require('xlsx');

/**
 * I51: exportación de pedidos a World Office (WO).
 * Preflight (errores bloqueantes + advertencias), archivo .xlsx de 57 columnas
 * con el consecutivo WO por empresa, marcado del pedido (trazabilidad) y
 * auditoría. I53: el archivo es Excel (.xlsx), igual al que espera WO.
 */
describe('Exportación World Office I51 (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let icvId: string;
  let comercialDefaultId: string;

  const configWo = {
    tipoDocumento: 'COT',
    prefijo: '',
    bodegaDefault: 'Principal',
    unidadMedida: 'Und.',
    formaPagoDefault: 'Credito 30 DIAS',
    diasVencimiento: 30,
    iva: 0.19,
  };

  function leerXlsx(res: any): any[][] {
    const wb = XLSX.read(res.body, { type: 'buffer' });
    const hoja = wb.SheetNames[0];
    return XLSX.utils.sheet_to_json(wb.Sheets[hoja], {
      header: 1,
      defval: '',
    }) as any[][];
  }

  // supertest no entrega binarios en res.body por defecto: parser manual.
  function descargarXlsxWo(token: string, orderIds: string[]) {
    return t.http
      .post('/api/v1/exports/world-office/pedidos.xlsx')
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .send({ orderIds });
  }

  async function crearPedidoAlistado(
    clienteId: string,
    comercialId: string | null,
    empresaId = ireId,
  ): Promise<string> {
    // GENERADOR debe enviar comercialId (M08); para los casos "sin comercial"
    // se crea con uno y se quita directamente en BD.
    const ped = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId,
        clienteId,
        comercialId: comercialId ?? comercialDefaultId,
        items: [{ referencia: 'WO-001', cantidad: 20 }],
      });
    expect(ped.status).toBe(201);
    await t.dataSource.query(
      `UPDATE orders SET estado='ALISTADO', alistado_at=now() WHERE id=$1`,
      [ped.body.id],
    );
    if (!comercialId) {
      await t.dataSource.query(`UPDATE orders SET comercial_id=NULL WHERE id=$1`, [
        ped.body.id,
      ]);
    }
    return ped.body.id;
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    const empresas = await t.dataSource.query(`SELECT id, siglas FROM companies`);
    ireId = empresas.find((e: any) => e.siglas === 'IRE').id;
    icvId = empresas.find((e: any) => e.siglas === 'ICV').id;

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

    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo: 'WO-001',
        descripcion: 'COLADOR ACEITE ESC (250) PCJ BRASIL',
        unidadMedida: 'UND',
        precio: 25210,
      });
    expect(prod.status).toBe(201);
    await t.dataSource.query(`UPDATE products SET cantidad=100 WHERE id=$1`, [prod.body.id]);
    // El mismo código también en ICV para la prueba multi-empresa
    await t.dataSource.query(
      `INSERT INTO products (id, empresa_id, codigo, descripcion, unidad_medida, cantidad, precio, estado)
       VALUES (gen_random_uuid(), $1, 'WO-001', 'COLADOR', 'UND', 100, 25210, 'ACTIVO')`,
      [icvId],
    );

    // Comercial por defecto para crear pedidos (GENERADOR lo requiere, M08)
    const comDefault = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Base WO', identificacion: '1234567' });
    comercialDefaultId = comDefault.body.id;

    // I52: la empresa emisora es el nombre de la empresa del pedido
    await t.dataSource.query(
      `UPDATE companies SET nombre='IMPORT - REPUESTOS EL ESCARABAJO S A S' WHERE id=$1`,
      [ireId],
    );

    // I52: configuración GLOBAL de WO (una sola para todas las empresas)
    const put = await t.http
      .put('/api/v1/admin/params/wo.export')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: configWo, motivo: 'Configuración inicial WO' });
    expect(put.status).toBe(200);
  });

  it('la migración sembró la config global y el consecutivo por empresa', async () => {
    const res = await t.http
      .get('/api/v1/admin/params')
      .set('Authorization', `Bearer ${adminToken}`);
    const claves = res.body.map((p: any) => p.clave);
    expect(claves).toContain('wo.export');
    expect(claves).toContain('wo.consecutivo.IRE');
    expect(claves).toContain('wo.consecutivo.ICV');
    // I52: las claves I51 por empresa fueron reemplazadas
    expect(claves).not.toContain('wo.export.IRE');
  });

  it('valida la configuración WO (iva fuera de rango → 400)', async () => {
    const res = await t.http
      .put('/api/v1/admin/params/wo.export')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: { ...configWo, iva: 1.5 }, motivo: 'prueba' });
    expect(res.status).toBe(400);
    // El consecutivo por empresa también se valida
    const malo = await t.http
      .put('/api/v1/admin/params/wo.consecutivo.IRE')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: { consecutivoActual: -1 }, motivo: 'prueba' });
    expect(malo.status).toBe(400);
  });

  it('preflight y Excel de un pedido alistado: 57 columnas, consecutivo y trazabilidad', async () => {
    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente WO', identificacion: 'NIT 901689082 1' });
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial WO', identificacion: 'CC 4.245.245' });
    const pedidoId = await crearPedidoAlistado(cli.body.id, com.body.id);

    const pre = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [pedidoId] });
    expect(pre.status).toBe(201);
    expect(pre.body.ok).toBe(true);
    expect(pre.body.resumen).toMatchObject({
      pedidos: 1,
      lineas: 1,
      documentoDesde: 1,
      documentoHasta: 1,
    });

    const xls = await descargarXlsxWo(generadorToken, [pedidoId]);
    expect(xls.status).toBe(201);
    expect(xls.headers['content-type']).toContain('spreadsheetml');
    expect(xls.headers['content-disposition']).toContain('WO-Pedidos-IRE-');
    expect(xls.headers['content-disposition']).toContain('.xlsx');
    const matriz = leerXlsx(xls);
    expect(matriz.length).toBe(2);
    expect(matriz[0].length).toBe(57);
    expect(matriz[0][0]).toBe('Encabezados: Empresa');
    const datos = matriz[1];
    expect(datos.length).toBe(57);
    expect(datos[0]).toBe('IMPORT - REPUESTOS EL ESCARABAJO S A S');
    expect(datos[1]).toBe('COT');
    expect(datos[3]).toBe(1); // primer consecutivo WO (numérico)
    expect(datos[5]).toBe('4245245'); // comercial limpio
    expect(datos[6]).toBe('901689082'); // NIT sin DV
    expect(datos[8]).toBe('Credito 30 DIAS');
    expect(datos[31]).toBe('WO-001');
    expect(datos[32]).toBe('Principal');
    expect(datos[34]).toBe(20);
    expect(datos[35]).toBe(0.19);
    expect(datos[36]).toBe(25210);

    // Trazabilidad en el pedido
    const pedido = await t.http
      .get(`/api/v1/orders/${pedidoId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(pedido.body.exportadoWo).toBe(true);
    expect(pedido.body.woDocumentoNumero).toBe(1);
    expect(pedido.body.loteExportacion).toBeTruthy();

    // Auditoría
    const audit = await t.dataSource.query(
      `SELECT accion, valor_nuevo FROM audit_logs WHERE accion='EXPORTACION_WORLD_OFFICE'`,
    );
    expect(audit.length).toBe(1);
    expect(audit[0].valor_nuevo.pedidos[0]).toMatchObject({
      id: pedidoId,
      documentoWo: 1,
    });

    // Reexportación: permitida con advertencia, conserva el número WO ya
    // asignado y no consume consecutivo nuevo (idempotencia).
    const pre2 = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [pedidoId] });
    expect(pre2.body.ok).toBe(true);
    expect(pre2.body.advertencias[0].mensaje).toContain('conservará el documento 1');
    expect(pre2.body.resumen.documentoDesde).toBeNull();

    const xls2 = await descargarXlsxWo(generadorToken, [pedidoId]);
    expect(xls2.status).toBe(201);
    expect(leerXlsx(xls2)[1][3]).toBe(1);
    const cfg = await t.dataSource.query(
      `SELECT valor FROM system_params WHERE clave='wo.consecutivo.IRE'`,
    );
    expect(cfg[0].valor.consecutivoActual).toBe(1);
  });

  it('bloquea pedidos no alistados y clientes sin identificación', async () => {
    const cliSinNit = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente Sin NIT' });
    const abierto = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        clienteId: cliSinNit.body.id,
        comercialId: comercialDefaultId,
        items: [{ referencia: 'WO-001', cantidad: 1 }],
      });
    expect(abierto.status).toBe(201);

    const pre = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [abierto.body.id] });
    expect(pre.body.ok).toBe(false);
    const mensajes = pre.body.errores.map((e: any) => e.mensaje).join(' | ');
    expect(mensajes).toContain('ALISTADOS');
    expect(mensajes).toContain('identificación');

    // El Excel se bloquea con los mismos errores
    const xls = await t.http
      .post('/api/v1/exports/world-office/pedidos.xlsx')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [abierto.body.id] });
    expect(xls.status).toBe(400);
    expect(xls.body.code).toBe('WO_PREFLIGHT_ERRORES');
  });

  it('bloquea la mezcla de empresas en una sola exportación', async () => {
    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente Multi', identificacion: '800111222' });
    const pedIre = await crearPedidoAlistado(cli.body.id, null, ireId);
    const pedIcv = await crearPedidoAlistado(cli.body.id, null, icvId);

    // Sin comercial en el pedido → también debe quejarse (I52: el NIT del
    // vendedor sale del comercial del pedido, no hay parámetro de respaldo)
    const pre = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [pedIre, pedIcv] });
    expect(pre.body.ok).toBe(false);
    const mensajes = pre.body.errores.map((e: any) => e.mensaje).join(' | ');
    expect(mensajes).toContain('misma empresa');
    expect(mensajes).toContain('comercial con identificación');
  });

  it('consecutivo independiente por empresa y NIT del comercial del pedido', async () => {
    const comIcv = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial ICV', identificacion: 'CC 5.555.555' });
    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente ICV', identificacion: '800333444' });
    const pedIcv = await crearPedidoAlistado(cli.body.id, comIcv.body.id, icvId);

    const xls = await descargarXlsxWo(generadorToken, [pedIcv]);
    expect(xls.status).toBe(201);
    const datos = leerXlsx(xls)[1];
    expect(datos[5]).toBe('5555555'); // NIT del comercial, solo dígitos
    expect(datos[3]).toBe(1); // consecutivo independiente por empresa
  });

  it('RBAC: GENERADOR, ADMINISTRADOR y OPERADOR exportan; COMERCIAL no (I53)', async () => {
    // I53: Operador también puede generar el archivo de World Office.
    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente RBAC WO', identificacion: '900999888' });
    const pedidoId = await crearPedidoAlistado(cli.body.id, comercialDefaultId);

    const preOp = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ orderIds: [pedidoId] });
    expect(preOp.status).toBe(201);
    expect(preOp.body.ok).toBe(true);

    const xlsOp = await descargarXlsxWo(operadorToken, [pedidoId]);
    expect(xlsOp.status).toBe(201);
    expect(xlsOp.headers['content-type']).toContain('spreadsheetml');

    // Comercial queda fuera por rol.
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Usuario comercial.wo',
        username: 'comercial.wo',
        email: 'comercial.wo@sofia.local',
        rol: 'COMERCIAL',
        claveInicial: 'ClaveInicial1',
      });
    const comToken = await loginAndSetPassword(t.http, 'comercial.wo', 'ClaveInicial1', 'ClaveNueva123');
    const res = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${comToken}`)
      .send({ orderIds: ['00000000-0000-0000-0000-000000000000'] });
    expect(res.status).toBe(403);
  });

  it('orderIds inválidos → 400', async () => {
    const res = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: [] });
    expect(res.status).toBe(400);
    const malo = await t.http
      .post('/api/v1/exports/world-office/preflight')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderIds: ['no-es-uuid'] });
    expect(malo.status).toBe(400);
  });
});
