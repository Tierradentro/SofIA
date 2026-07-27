import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I2 — HU-008 Transportadoras: CRUD por Administrador, unicidad,
 * tipo INTERNA sin guía, RBAC negativo 403, listado operativo.
 */
describe('Transportadoras (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let operadorToken: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador I2',
        username: 'operador.i2',
        email: 'operador.i2@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    operadorToken = await loginAndSetPassword(
      t.http, 'operador.i2', 'ClaveInicial1', 'OperadorClave9',
    );
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-008: Administrador crea transportadora externa e interna; quedan auditadas', async () => {
    let res = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Servientrega', tipo: 'EXTERNA', identificacion: '900123' });
    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('EXTERNA');

    res = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Transporte Propio', tipo: 'INTERNA' });
    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('INTERNA');

    const logs = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE tabla='carriers' AND accion='CREAR'`,
    );
    expect(logs[0].n).toBe(2);
  });

  it('HU-008: nombre duplicado → 409', async () => {
    const res = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Servientrega', tipo: 'EXTERNA' });
    expect(res.status).toBe(409);
  });

  it('RBAC negativo: Operador recibe 403 al crear/editar transportadoras', async () => {
    const post = await t.http
      .post('/api/v1/carriers')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ nombre: 'Coordinadora', tipo: 'EXTERNA' });
    expect(post.status).toBe(403);

    const carriers = await t.dataSource.query(`SELECT id FROM carriers LIMIT 1`);
    const patch = await t.http
      .patch(`/api/v1/carriers/${carriers[0].id}`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ telefonos: '123' });
    expect(patch.status).toBe(403);
  });

  it('Operador sí puede consultar el listado operativo de transportadoras activas', async () => {
    const res = await t.http
      .get('/api/v1/carriers/activas')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(res.status).toBe(200);
    const nombres = res.body.map((c: any) => c.nombre);
    expect(nombres).toContain('Servientrega');
    expect(nombres).toContain('Transporte Propio');
  });

  it('Desactivar una transportadora la excluye del listado operativo', async () => {
    const carriers = await t.dataSource.query(
      `SELECT id FROM carriers WHERE nombre='Servientrega'`,
    );
    const res = await t.http
      .patch(`/api/v1/carriers/${carriers[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ activo: false });
    expect(res.status).toBe(200);

    const activas = await t.http
      .get('/api/v1/carriers/activas')
      .set('Authorization', `Bearer ${operadorToken}`);
    const nombres = activas.body.map((c: any) => c.nombre);
    expect(nombres).not.toContain('Servientrega');
    expect(nombres).toContain('Transporte Propio');
  });
});
