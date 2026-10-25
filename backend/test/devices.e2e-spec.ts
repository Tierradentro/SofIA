import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
  DISPOSITIVO_TEST,
} from './helpers/test-app';

/**
 * I57: control de dispositivos (navegadores autorizados).
 * - El login exige la huella del navegador.
 * - El primer login del Administrador desde un navegador lo aprueba solo.
 * - Otros roles quedan en pantalla de espera hasta la aprobación manual.
 * - Aprobar / rechazar / revocar registran fecha y usuario; la revocación
 *   bloquea sesiones ya emitidas (el guard revalida en cada petición).
 * - El módulo de administración es exclusivo del Administrador.
 */
describe('Dispositivos (e2e)', () => {
  let t: TestApp;
  let adminToken: string;

  const DISP_ADMIN = DISPOSITIVO_TEST;
  const DISP_OPERADOR = { deviceId: 'e2e-navegador-operador', nombre: 'Firefox · Windows' };

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    // El login del Administrador con un navegador nuevo lo auto-aprueba
    adminToken = await loginAndSetPassword(
      t.http,
      ADMIN.username,
      ADMIN.password,
      ADMIN_NUEVA_CLAVE,
    );
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('el login sin huella de dispositivo se rechaza (400)', async () => {
    const res = await t.http
      .post('/api/v1/auth/login')
      .send({ username: ADMIN.username, password: 'x' });
    expect(res.status).toBe(400);
  });

  it('el primer login del Administrador auto-aprueba su navegador', async () => {
    const rows = await t.dataSource.query(
      `SELECT estado, aprobado_at, aprobado_por_nombre FROM devices WHERE device_id = $1`,
      [DISP_ADMIN.deviceId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0].estado).toBe('APROBADO');
    expect(rows[0].aprobado_at).not.toBeNull();
    expect(rows[0].aprobado_por_nombre).toContain('automático');
  });

  it('un usuario no administrador queda en espera: login sin token y sondeo PENDIENTE', async () => {
    // Admin crea el operador
    const creado = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador Dispositivos',
        username: 'operador.disp',
        email: 'operador.disp@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    expect(creado.status).toBe(201);

    // Primer login desde un navegador nuevo: no emite token
    const login = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.disp', password: 'ClaveInicial1', dispositivo: DISP_OPERADOR });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeUndefined();
    expect(login.body).toMatchObject({
      dispositivoAutorizado: false,
      estadoDispositivo: 'PENDIENTE',
    });

    // La pantalla de espera sondea el estado (endpoint público)
    const estado = await t.http
      .get('/api/v1/devices/estado')
      .set('X-Device-Id', DISP_OPERADOR.deviceId);
    expect(estado.status).toBe(200);
    expect(estado.body.estado).toBe('PENDIENTE');
  });

  it('solo el Administrador ve el módulo; registra características del navegador', async () => {
    const prohibido = await t.http
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', 'otro-navegador');
    // Token ligado al navegador del admin: otro X-Device-Id es rechazado
    expect(prohibido.status).toBe(403);
    expect(prohibido.body.code).toBe('DISPOSITIVO_NO_AUTORIZADO');

    const lista = await t.http
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    expect(lista.status).toBe(200);
    const dispOp = lista.body.find((d: any) => d.deviceId === DISP_OPERADOR.deviceId);
    expect(dispOp).toBeDefined();
    expect(dispOp.nombre).toBe('Firefox · Windows');
    expect(dispOp.estado).toBe('PENDIENTE');
    expect(dispOp.registradoPorNombre).toBe('Operador Dispositivos');
  });

  it('aprobar habilita el login; el token queda ligado al navegador', async () => {
    const lista = await t.http
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    const dispOp = lista.body.find((d: any) => d.deviceId === DISP_OPERADOR.deviceId);

    const aprobado = await t.http
      .post(`/api/v1/devices/${dispOp.id}/aprobar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    expect(aprobado.status).toBe(200);
    expect(aprobado.body.estado).toBe('APROBADO');
    expect(aprobado.body.aprobadoAt).not.toBeNull();
    expect(aprobado.body.aprobadoPorNombre).toBeTruthy();

    // La pantalla de espera ya lo ve aprobado y el login emite token
    const estado = await t.http
      .get('/api/v1/devices/estado')
      .set('X-Device-Id', DISP_OPERADOR.deviceId);
    expect(estado.body.estado).toBe('APROBADO');

    const login = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.disp', password: 'ClaveInicial1', dispositivo: DISP_OPERADOR });
    expect(login.status).toBe(200);
    expect(login.body.access_token).toBeDefined();

    // Primer login: cambio obligatorio de clave (M02) desde el mismo navegador
    const cambio = await t.http
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${login.body.access_token}`)
      .set('X-Device-Id', DISP_OPERADOR.deviceId)
      .send({ claveActual: 'ClaveInicial1', claveNueva: 'OperadorClave9', confirmacion: 'OperadorClave9' });
    expect(cambio.status).toBe(200);

    const reloginOk = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.disp', password: 'OperadorClave9', dispositivo: DISP_OPERADOR });
    const tokenOp = reloginOk.body.access_token;
    expect(tokenOp).toBeDefined();

    // El token sirve desde el navegador autorizado…
    const ok = await t.http
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenOp}`)
      .set('X-Device-Id', DISP_OPERADOR.deviceId);
    expect(ok.status).toBe(200);

    // …pero no desde otro navegador
    const otro = await t.http
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenOp}`)
      .set('X-Device-Id', 'navegador-intruso');
    expect(otro.status).toBe(403);
    expect(otro.body.code).toBe('DISPOSITIVO_NO_AUTORIZADO');

    // Revocar bloquea de inmediato la sesión ya emitida
    const revocado = await t.http
      .post(`/api/v1/devices/${dispOp.id}/revocar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    expect(revocado.status).toBe(200);
    expect(revocado.body.estado).toBe('REVOCADO');
    expect(revocado.body.revocadoAt).not.toBeNull();
    expect(revocado.body.revocadoPorNombre).toBeTruthy();

    const bloqueado = await t.http
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenOp}`)
      .set('X-Device-Id', DISP_OPERADOR.deviceId);
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.code).toBe('DISPOSITIVO_NO_AUTORIZADO');

    // Y el login vuelve a la pantalla de espera (ahora REVOCADO)
    const relogin = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.disp', password: 'OperadorClave9', dispositivo: DISP_OPERADOR });
    expect(relogin.body).toMatchObject({
      dispositivoAutorizado: false,
      estadoDispositivo: 'REVOCADO',
    });
  });

  it('rechazar registra fecha y usuario; un aprobado no se rechaza, se revoca', async () => {
    // Dispositivo fresco en PENDIENTE
    await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.disp', password: 'OperadorClave9', dispositivo: { deviceId: 'e2e-navegador-rechazo', nombre: 'Edge · Android' } });
    const lista = await t.http
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    const pendiente = lista.body.find((d: any) => d.deviceId === 'e2e-navegador-rechazo');

    const rechazado = await t.http
      .post(`/api/v1/devices/${pendiente.id}/rechazar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    expect(rechazado.status).toBe(200);
    expect(rechazado.body.estado).toBe('RECHAZADO');
    expect(rechazado.body.rechazadoAt).not.toBeNull();
    expect(rechazado.body.rechazadoPorNombre).toBeTruthy();

    // Reglas de transición
    const revocarNoAprobado = await t.http
      .post(`/api/v1/devices/${pendiente.id}/revocar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    expect(revocarNoAprobado.status).toBe(400);

    const dispAdmin = lista.body.find((d: any) => d.deviceId === DISP_ADMIN.deviceId);
    const rechazarAprobado = await t.http
      .post(`/api/v1/devices/${dispAdmin.id}/rechazar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    expect(rechazarAprobado.status).toBe(400);
  });

  it('RBAC: un operador no puede administrar dispositivos', async () => {
    // El navegador del operador quedó REVOCADO; lo aprobamos para el login
    const lista = await t.http
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);
    const dispOp = lista.body.find((d: any) => d.deviceId === DISP_OPERADOR.deviceId);
    await t.http
      .post(`/api/v1/devices/${dispOp.id}/aprobar`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Device-Id', DISP_ADMIN.deviceId);

    const login = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.disp', password: 'OperadorClave9', dispositivo: DISP_OPERADOR });
    const tokenOp = login.body.access_token;

    const prohibido = await t.http
      .get('/api/v1/devices')
      .set('Authorization', `Bearer ${tokenOp}`)
      .set('X-Device-Id', DISP_OPERADOR.deviceId);
    expect(prohibido.status).toBe(403);
  });
});
