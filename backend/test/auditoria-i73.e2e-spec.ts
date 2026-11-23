import { readFileSync } from 'fs';
import { join } from 'path';
import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
  DISPOSITIVO_TEST,
} from './helpers/test-app';

const PNG_REAL = readFileSync(join(__dirname, 'fixtures', 'factura-ocr.png'));
const SVG_XSS = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
);

/**
 * I73 — regresión e2e de las correcciones de la auditoría:
 * - Hallazgo 3: un SVG declarado como imagen se rechaza en soportes PQRS y
 *   fotos de producto (anti-XSS); las descargas sirven con attachment,
 *   nosniff y CSP restrictiva.
 * - Hallazgo 4: solo el PRIMER navegador del Administrador se auto-aprueba.
 * - Hallazgo 6: bloqueo temporal de 15 min con desbloqueo automático.
 * - Hallazgo 7: registrar transporte REVALIDA cajas y pendientes dentro de
 *   una transacción, aunque el empaque ya se hubiera finalizado.
 * (Los hallazgos 1 y 2 —doble aprobación de ingresos y conteos— quedan
 * cubiertos por inbound.e2e-spec.ts e inventories.e2e-spec.ts, que verifican
 * el 400 de la segunda aprobación; el hallazgo 5 tiene su prueba unitaria en
 * documents-security.spec.ts.)
 */
describe('Auditoría I73 (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let clienteId: string;
  let comercialId: string;
  let productoId: string;

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
      .send({ nombre: 'Cliente I73', identificacion: '900731001', ciudad: 'Bogotá', direccion: 'Av 7 # 3-1' });
    clienteId = cli.body.id;
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial I73', identificacion: 'C-I73' });
    comercialId = com.body.id;

    for (const [username, rol] of [
      ['generador.i73', 'GENERADOR'],
      ['operador.i73', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i73', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i73', 'ClaveInicial1', 'ClaveNueva123');

    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: ireId, codigo: 'I73-001', descripcion: 'Producto I73', unidadMedida: 'UND', precio: 5000 });
    expect(prod.status).toBe(201);
    productoId = prod.body.id;
    await t.dataSource.query(`UPDATE products SET cantidad=10 WHERE id=$1`, [productoId]);
    const bc = await t.http
      .post(`/api/v1/products/${productoId}/barcode`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ barcode: '7597301', origen: 'MANUAL' });
    expect(bc.status).toBe(201);
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('Hallazgo 4: solo el PRIMER navegador del Administrador se auto-aprueba', async () => {
    // El beforeAll ya hizo el primer login del Admin (navegador auto-aprobado).
    const primero = await t.dataSource.query(
      `SELECT estado, aprobado_por_nombre FROM devices WHERE device_id=$1`,
      [DISPOSITIVO_TEST.deviceId],
    );
    expect(primero[0].estado).toBe('APROBADO');
    expect(primero[0].aprobado_por_nombre).toContain('automático');

    // Un SEGUNDO navegador del mismo Administrador queda en pantalla de espera
    const segundo = await t.http.post('/api/v1/auth/login').send({
      username: ADMIN.username,
      password: ADMIN_NUEVA_CLAVE,
      dispositivo: { deviceId: 'e2e-admin-segundo-navegador', nombre: 'Otro navegador' },
    });
    expect(segundo.status).toBe(200);
    expect(segundo.body.access_token).toBeUndefined();
    expect(segundo.body).toMatchObject({
      dispositivoAutorizado: false,
      estadoDispositivo: 'PENDIENTE',
    });
    const fila = await t.dataSource.query(
      `SELECT estado FROM devices WHERE device_id='e2e-admin-segundo-navegador'`,
    );
    expect(fila[0].estado).toBe('PENDIENTE');
  });

  it('Hallazgo 6: el bloqueo por intentos es temporal (15 min) y se levanta solo', async () => {
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador Bloqueo',
        username: 'operador.bloqueo',
        email: 'operador.bloqueo@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });

    for (let i = 0; i < 5; i++) {
      const res = await t.http
        .post('/api/v1/auth/login')
        .send({ username: 'operador.bloqueo', password: 'mala', dispositivo: DISPOSITIVO_TEST });
      expect(res.status).toBe(401);
    }

    // Bloqueado con fecha de expiración a ~15 minutos
    const bloqueado = await t.dataSource.query(
      `SELECT estado, bloqueado_hasta FROM users WHERE username='operador.bloqueo'`,
    );
    expect(bloqueado[0].estado).toBe('BLOQUEADO');
    expect(bloqueado[0].bloqueado_hasta).not.toBeNull();
    const msRestantes = new Date(bloqueado[0].bloqueado_hasta).getTime() - Date.now();
    expect(msRestantes).toBeGreaterThan(10 * 60_000);
    expect(msRestantes).toBeLessThanOrEqual(15 * 60_000 + 5_000);

    // Ni con la clave correcta entra mientras el bloqueo sigue vigente
    const aunBloqueado = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.bloqueo', password: 'ClaveInicial1', dispositivo: DISPOSITIVO_TEST });
    expect(aunBloqueado.status).toBe(401);

    // Al expirar el bloqueo, el siguiente login lo levanta solo
    await t.dataSource.query(
      `UPDATE users SET bloqueado_hasta = now() - interval '1 minute' WHERE username='operador.bloqueo'`,
    );
    const login = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.bloqueo', password: 'ClaveInicial1', dispositivo: DISPOSITIVO_TEST });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeDefined();

    const desbloqueado = await t.dataSource.query(
      `SELECT estado, intentos_fallidos, bloqueado_hasta FROM users WHERE username='operador.bloqueo'`,
    );
    expect(desbloqueado[0].estado).toBe('ACTIVO');
    expect(desbloqueado[0].intentos_fallidos).toBe(0);
    expect(desbloqueado[0].bloqueado_hasta).toBeNull();

    const audit = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE accion='USUARIO_DESBLOQUEADO_AUTOMATICO'`,
    );
    expect(audit.length).toBe(1);
  });

  it('Hallazgo 3: un SVG con <script> se rechaza como soporte PQRS aunque declare ser imagen', async () => {
    const caso = await t.http
      .post('/api/v1/pqrs')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        clienteId,
        codigo: 'I73-001',
        motivoCodigo: 'G08',
        descripcionCaso: 'Caso para probar la carga de soportes',
        facturaObservacion: 'Factura verificada con el comercial',
      });
    expect(caso.status).toBe(201);

    // SVG declarado como SVG
    const svg = await t.http
      .post(`/api/v1/pqrs/${caso.body.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .attach('file', SVG_XSS, { filename: 'xss.svg', contentType: 'image/svg+xml' });
    expect(svg.status).toBe(400);
    expect(svg.body.message).toContain('PNG, JPEG o WEBP');

    // SVG declarado como PNG (Content-Type mentiroso): se miran los bytes
    const svgDisfrazado = await t.http
      .post(`/api/v1/pqrs/${caso.body.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .attach('file', SVG_XSS, { filename: 'xss.png', contentType: 'image/png' });
    expect(svgDisfrazado.status).toBe(400);

    // PNG real sí pasa…
    const ok = await t.http
      .post(`/api/v1/pqrs/${caso.body.id}/soportes`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .attach('file', PNG_REAL, { filename: 'soporte.png', contentType: 'image/png' });
    expect(ok.status).toBe(201);

    // …y la descarga se sirve como adjunto no ejecutable en el origen
    const archivo = await t.http
      .get(`/api/v1/pqrs/soportes/${ok.body.id}/archivo`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: any[] = [];
        res.on('data', (c: any) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(archivo.status).toBe(200);
    expect(archivo.headers['content-type']).toContain('image/png');
    expect(archivo.headers['content-disposition']).toContain('attachment');
    expect(archivo.headers['x-content-type-options']).toBe('nosniff');
    expect(archivo.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('Hallazgo 3: la foto de producto exige PNG/JPEG/WEBP real y se descarga segura', async () => {
    const svg = await t.http
      .post(`/api/v1/products/${productoId}/foto`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .attach('file', SVG_XSS, { filename: 'foto.png', contentType: 'image/png' });
    expect(svg.status).toBe(400);

    const ok = await t.http
      .post(`/api/v1/products/${productoId}/foto`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .attach('file', PNG_REAL, { filename: 'foto.png', contentType: 'image/png' });
    expect([200, 201]).toContain(ok.status);

    const foto = await t.http
      .get(`/api/v1/products/${productoId}/foto`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .buffer(true)
      .parse((res: any, cb: any) => {
        const chunks: any[] = [];
        res.on('data', (c: any) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(foto.status).toBe(200);
    expect(foto.headers['content-disposition']).toContain('attachment');
    expect(foto.headers['x-content-type-options']).toBe('nosniff');
    expect(foto.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('Hallazgo 7: registrar transporte revalida cajas y pendientes tras finalizar el empaque', async () => {
    // Pedido APROBADO con 2 unidades alistadas
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        clienteId,
        comercialId,
        items: [{ referencia: 'I73-001', cantidad: 2 }],
      });
    expect(pedido.status).toBe(201);
    const scan = await t.http
      .post(`/api/v1/orders/${pedido.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ modo: 'COMPLETO', codigo: '7597301', cantidad: 2 });
    expect(scan.status).toBe(201);
    await t.http
      .post(`/api/v1/orders/${pedido.body.id}/finalizar-picking`)
      .set('Authorization', `Bearer ${operadorToken}`);
    await t.dataSource.query(
      `UPDATE orders SET estado='APROBADO', aprobado_at=now() WHERE id=$1`,
      [pedido.body.id],
    );

    const despacho = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ orderId: pedido.body.id });
    expect(despacho.status).toBe(201);
    const dId = despacho.body.id;
    await t.http.post(`/api/v1/dispatches/${dId}/aprobar`).set('Authorization', `Bearer ${generadorToken}`);

    // Caja 1 con las 2 unidades, cerrada; empaque finalizado sin pendientes
    const caja1 = await t.http.post(`/api/v1/dispatches/${dId}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${caja1.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7597301', cantidad: 2 });
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${caja1.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const fin = await t.http
      .post(`/api/v1/dispatches/${dId}/finalizar-empaque`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(fin.status).toBe(201);
    expect(fin.body.empaqueFinalizado).toBe(true);

    // (a) Caja ABIERTA creada DESPUÉS de finalizar: el transporte la detecta
    const caja2 = await t.http.post(`/api/v1/dispatches/${dId}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    expect(caja2.status).toBe(201);
    const conAbierta = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia' });
    expect(conAbierta.status).toBe(400);
    expect(conAbierta.body.message).toContain('ABIERTA');
    await t.http
      .delete(`/api/v1/dispatches/${dId}/boxes/${caja2.body.id}`)
      .set('Authorization', `Bearer ${operadorToken}`);

    // (b) Sin ninguna caja cerrada tampoco sale (se elimina la caja 1, lo que
    // revierte sus unidades: quedan pendientes Y sin cajas)
    await t.http
      .delete(`/api/v1/dispatches/${dId}/boxes/${caja1.body.id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const sinCerradas = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia' });
    expect(sinCerradas.status).toBe(400);
    expect(sinCerradas.body.message).toContain('cajas cerradas');

    // (c) Con caja cerrada pero unidades pendientes tampoco sale
    const caja3 = await t.http.post(`/api/v1/dispatches/${dId}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${caja3.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7597301', cantidad: 1 });
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${caja3.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const conPendientes = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia' });
    expect(conPendientes.status).toBe(400);
    expect(conPendientes.body.message).toContain('pendiente');

    // (d) Recuperación: se empaca la unidad faltante y el transporte sale
    const caja4 = await t.http.post(`/api/v1/dispatches/${dId}/boxes`).set('Authorization', `Bearer ${operadorToken}`);
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${caja4.body.id}/scan`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ codigo: '7597301', cantidad: 1 });
    await t.http
      .post(`/api/v1/dispatches/${dId}/boxes/${caja4.body.id}/cerrar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    const salida = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia' });
    expect(salida.status).toBe(201);
    expect(salida.body.estado).toBe('DESPACHADO');

    // (e) Un segundo registro de transporte se rechaza (estado ya DESPACHADO)
    const repetido = await t.http
      .post(`/api/v1/dispatches/${dId}/transporte`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ tipo: 'INTERNA', nombreTransporte: 'Flota Propia' });
    expect(repetido.status).toBe(400);
  });
});
