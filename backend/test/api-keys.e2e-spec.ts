import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I2 — M17 API keys: creación asociada a usuario rol API (M14), consulta
 * enmascarada, edición, eliminación, RBAC negativo 403.
 */
describe('API keys (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let operadorToken: string;
  let apiUserId: string;
  let operadorId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    const apiUser = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Cliente OpenClaw',
        username: 'api.openclaw',
        email: 'api.openclaw@sofia.local',
        rol: 'API',
        claveInicial: 'ClaveInicial1',
      });
    apiUserId = apiUser.body.id;

    const opUser = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador Keys',
        username: 'operador.keys',
        email: 'operador.keys@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    operadorId = opUser.body.id;
    operadorToken = await loginAndSetPassword(
      t.http, 'operador.keys', 'ClaveInicial1', 'OperadorClave9',
    );
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  let keyId: string;

  it('M17: crear API key para usuario rol API; clave completa se muestra una sola vez', async () => {
    const res = await t.http
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: apiUserId, nombre: 'Integración OpenClaw' });
    expect(res.status).toBe(201);
    expect(res.body.clave).toMatch(/^sk_[0-9a-f]{48}$/);
    keyId = res.body.id;

    // En consulta posterior NO aparece la clave en claro (enmascarada)
    const list = await t.http
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${adminToken}`);
    const item = list.body.find((k: any) => k.id === keyId);
    expect(item.key).toContain('•');
    expect(item.clave).toBeUndefined();
    expect(item.keyHash).toBeUndefined();
  });

  it('M17/M14: rechaza crear key para usuario sin rol API', async () => {
    const res = await t.http
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: operadorId, nombre: 'Key inválida' });
    expect(res.status).toBe(400);
  });

  it('M17: modificar (desactivar) y eliminar, ambos auditados', async () => {
    const patch = await t.http
      .patch(`/api/v1/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ activo: false });
    expect(patch.status).toBe(200);
    expect(patch.body.activo).toBe(false);

    const del = await t.http
      .delete(`/api/v1/api-keys/${keyId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const logs = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE tabla='api_keys' AND registro_id=$1 ORDER BY id`,
      [keyId],
    );
    expect(logs.map((l: any) => l.accion)).toEqual(['CREAR', 'EDITAR', 'ELIMINAR']);
  });

  it('RBAC negativo: Operador recibe 403 en gestión de API keys', async () => {
    const get = await t.http
      .get('/api/v1/api-keys')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(get.status).toBe(403);

    const post = await t.http
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ userId: apiUserId, nombre: 'X' });
    expect(post.status).toBe(403);
  });
});
