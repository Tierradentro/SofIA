import {
  createTestApp,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * HU-001/002/003 + M02: login, mensaje genérico, bloqueo 5 intentos,
 * cambio obligatorio de clave en primer login, política de clave, logout.
 */
describe('Autenticación (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-001: login Admin/Admin exitoso con cambio de clave obligatorio (M14/M02)', async () => {
    const res = await t.http.post('/api/v1/auth/login').send(ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeDefined();
    expect(res.body.usuario.rol).toBe('ADMINISTRADOR');
    expect(res.body.usuario.debeCambiarClave).toBe(true);
  });

  it('HU-001: credenciales inválidas muestran error genérico sin revelar información', async () => {
    const a = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'noexiste', password: 'x' });
    const b = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'Admin', password: 'incorrecta' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.message).toBe(b.body.message);
    expect(a.body.message).toBe('Usuario o contraseña incorrectos');
  });

  it('M02: la puerta de cambio de clave bloquea otros endpoints hasta cambiarla', async () => {
    const login = await t.http.post('/api/v1/auth/login').send(ADMIN);
    const token = login.body.access_token;
    const res = await t.http
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('HU-003: cambio de clave exige actual correcta, confirmación y política', async () => {
    const login = await t.http.post('/api/v1/auth/login').send(ADMIN);
    const token = login.body.access_token;

    // Confirmación no coincide
    let res = await t.http
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ claveActual: 'Admin', claveNueva: 'NuevaClave123', confirmacion: 'otra' });
    expect(res.status).toBe(400);

    // Clave actual incorrecta
    res = await t.http
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ claveActual: 'mala', claveNueva: 'NuevaClave123', confirmacion: 'NuevaClave123' });
    expect(res.status).toBe(400);

    // Política: sin mayúscula / corta
    res = await t.http
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ claveActual: 'Admin', claveNueva: 'debil1', confirmacion: 'debil1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PASSWORD_POLICY_VIOLATION');

    // Correcto
    res = await t.http
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ claveActual: 'Admin', claveNueva: ADMIN_NUEVA_CLAVE, confirmacion: ADMIN_NUEVA_CLAVE });
    expect(res.status).toBe(200);

    // Ahora sí accede
    const relogin = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'Admin', password: ADMIN_NUEVA_CLAVE });
    expect(relogin.status).toBe(200);
    expect(relogin.body.usuario.debeCambiarClave).toBe(false);
  });

  it('M02: bloqueo tras 5 intentos fallidos; luego ni con la clave correcta entra', async () => {
    // Crea un usuario para no interferir con Admin
    const adminToken = await loginAdmin();
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador Prueba',
        username: 'operador.test',
        email: 'operador.test@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });

    for (let i = 0; i < 5; i++) {
      const res = await t.http
        .post('/api/v1/auth/login')
        .send({ username: 'operador.test', password: 'mala' });
      expect(res.status).toBe(401);
    }
    // Sexto intento con la clave correcta: sigue fuera (bloqueado)
    const res = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.test', password: 'ClaveInicial1' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Usuario o contraseña incorrectos');

    // Quedó auditado el bloqueo
    const logs = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE tabla='users' AND accion='USUARIO_BLOQUEADO_INTENTOS'`,
    );
    expect(logs.length).toBe(1);
  });

  it('HU-002: logout invalida el token', async () => {
    const token = await loginAdmin();
    const out = await t.http
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);
    expect(out.status).toBe(200);
    const res = await t.http
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('Sin token no accede a endpoints protegidos', async () => {
    const res = await t.http.get('/api/v1/users');
    expect(res.status).toBe(401);
  });

  async function loginAdmin(): Promise<string> {
    const res = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'Admin', password: ADMIN_NUEVA_CLAVE });
    return res.body.access_token;
  }
});
