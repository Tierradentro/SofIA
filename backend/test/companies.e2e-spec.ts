import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * M03 Empresas: seeds IRE/ICV, siglas obligatorias (P-09), unicidad,
 * lectura para todos los roles (M02) y escritura solo Administrador.
 */
describe('Empresas (e2e)', () => {
  let t: TestApp;
  let adminToken: string;

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

  it('Seed I0: existen IRE e ICV con sus siglas', async () => {
    const res = await t.http
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const nombres = res.body.map((c: any) => c.nombre);
    expect(nombres).toContain('IRE');
    expect(nombres).toContain('ICV');
    const ire = res.body.find((c: any) => c.nombre === 'IRE');
    expect(ire.siglas).toBe('IRE');
  });

  it('Crear empresa exige siglas válidas y las normaliza a mayúsculas (P-09)', async () => {
    // Sin siglas → 400
    let res = await t.http
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Empresa Nueva SAS' });
    expect(res.status).toBe(400);

    // Siglas en minúsculas → se normalizan
    res = await t.http
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Empresa Nueva SAS', siglas: 'enw', ciudad: 'Bogotá' });
    expect(res.status).toBe(201);
    expect(res.body.siglas).toBe('ENW');

    // Siglas duplicadas → 409
    res = await t.http
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Otra Empresa', siglas: 'ENW' });
    expect(res.status).toBe(409);
  });

  it('Lectura abierta a cualquier rol autenticado; escritura solo Administrador', async () => {
    // Crea un operador
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador Dos',
        username: 'operador2',
        email: 'operador2@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    const operadorToken = await loginAndSetPassword(
      t.http,
      'operador2',
      'ClaveInicial1',
      'OperadorClave9',
    );

    const get = await t.http
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(get.status).toBe(200);

    // RBAC negativo: operador no puede crear empresas
    const post = await t.http
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ nombre: 'Empresa Pirata', siglas: 'PIR' });
    expect(post.status).toBe(403);
  });
});
