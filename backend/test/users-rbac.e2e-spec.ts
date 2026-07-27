import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * HU-004/005 + RBAC: creación de usuarios por Administrador, auditoría,
 * inactivación que impide el login, y pruebas negativas 403 por rol.
 */
describe('Usuarios y RBAC (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let operadorId: string;
  let operadorToken: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
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

  it('HU-004: Administrador crea usuario con rol y queda auditado', async () => {
    const res = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador Uno',
        username: 'operador1',
        email: 'operador1@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    expect(res.status).toBe(201);
    expect(res.body.rol).toBe('OPERADOR');
    expect(res.body.passwordHash).toBeUndefined(); // nunca expone el hash
    operadorId = res.body.id;

    const logs = await t.dataSource.query(
      `SELECT accion, tabla, valor_nuevo FROM audit_logs WHERE tabla='users' AND registro_id=$1 AND accion='CREAR'`,
      [operadorId],
    );
    expect(logs.length).toBe(1);
    expect(logs[0].valor_nuevo.passwordHash).toBeUndefined();
    expect(logs[0].valor_nuevo.rol).toBe('OPERADOR');
  });

  it('HU-004: rechaza clave inicial débil y username duplicado', async () => {
    let res = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Debil',
        username: 'debil',
        email: 'debil@sofia.local',
        rol: 'OPERADOR',
        claveInicial: '123',
      });
    expect(res.status).toBe(400);

    res = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Duplicado',
        username: 'operador1',
        email: 'otro@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    expect(res.status).toBe(409);
  });

  it('M02: el usuario nuevo debe cambiar la clave en su primer login', async () => {
    const res = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador1', password: 'ClaveInicial1' });
    expect(res.status).toBe(200);
    expect(res.body.usuario.debeCambiarClave).toBe(true);

    operadorToken = await loginAndSetPassword(
      t.http,
      'operador1',
      'ClaveInicial1',
      'OperadorClave9',
    );
    expect(operadorToken).toBeDefined();
  });

  it('RBAC negativo: Operador recibe 403 en gestión de usuarios (HU-004)', async () => {
    const get = await t.http
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(get.status).toBe(403);

    const post = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        nombre: 'X',
        username: 'x',
        email: 'x@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    expect(post.status).toBe(403);
  });

  it('RBAC negativo: Operador recibe 403 en correcciones administrativas (HU-064)', async () => {
    const res = await t.http
      .post('/api/v1/admin/corrections')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        tabla: 'users',
        registroId: operadorId,
        campo: 'nombre',
        valorNuevo: 'Hackeado',
        motivo: 'intento',
      });
    expect(res.status).toBe(403);
  });

  it('HU-005: usuario inactivado no puede iniciar sesión y el cambio queda auditado', async () => {
    const res = await t.http
      .patch(`/api/v1/users/${operadorId}/estado`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'CANCELADO', motivo: 'Retiro de la empresa' });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('CANCELADO');

    const login = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador1', password: 'OperadorClave9' });
    expect(login.status).toBe(401);

    const logs = await t.dataSource.query(
      `SELECT valor_anterior, valor_nuevo, motivo FROM audit_logs WHERE tabla='users' AND registro_id=$1 AND accion='CAMBIO_ESTADO'`,
      [operadorId],
    );
    expect(logs.length).toBe(1);
    expect(logs[0].valor_anterior.estado).toBe('ACTIVO');
    expect(logs[0].valor_nuevo.estado).toBe('CANCELADO');
    expect(logs[0].motivo).toBe('Retiro de la empresa');
  });

  it('Recuperación de clave por Administrador (P-07): clave temporal + cambio obligatorio', async () => {
    // Reactiva primero
    await t.http
      .patch(`/api/v1/users/${operadorId}/estado`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ estado: 'ACTIVO' });

    const res = await t.http
      .post(`/api/v1/users/${operadorId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const temporal = res.body.claveTemporal;
    expect(temporal).toBeDefined();

    const login = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador1', password: temporal });
    expect(login.status).toBe(200);
    expect(login.body.usuario.debeCambiarClave).toBe(true);
  });
});
