import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * QA Func. 1.3: los mensajes del ValidationPipe global llegan en español,
 * tanto por traducción genérica como por mensajes personalizados (respetados).
 */
describe('Validación en español (e2e)', () => {
  let t: TestApp;
  let generadorToken: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    const adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    // POST /products y POST /orders son de GENERADOR: el 403 llegaría antes
    // que la validación; el test debe pasar el guard de roles.
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Generador validación',
        username: 'generador.val',
        email: 'generador.val@sofia.local',
        rol: 'GENERADOR',
        claveInicial: 'ClaveInicial1',
      });
    generadorToken = await loginAndSetPassword(
      t.http, 'generador.val', 'ClaveInicial1', 'ClaveNueva123',
    );
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('POST /products sin código → mensajes en español, sin inglés', async () => {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ empresaId: crypto.randomUUID(), descripcion: 'Sin código' });
    expect(res.status).toBe(400);
    const mensajes: string[] = Array.isArray(res.body.message)
      ? res.body.message
      : [res.body.message];
    const texto = mensajes.join(' | ');
    expect(texto).toContain("El campo 'codigo' es obligatorio");
    // Ningún mensaje en inglés
    expect(texto).not.toMatch(/should not be empty|must be|should not exist/);
  });

  it('campo desconocido (whitelist) → español', async () => {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: crypto.randomUUID(),
        codigo: 'X-1',
        descripcion: 'Prueba',
        campoInventado: 'x',
      });
    expect(res.status).toBe(400);
    const texto = (Array.isArray(res.body.message)
      ? res.body.message
      : [res.body.message]
    ).join(' | ');
    expect(texto).toContain("El campo 'campoInventado' no está permitido");
  });

  it('POST /orders con item sin cantidad → español', async () => {
    const res = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: crypto.randomUUID(),
        clienteId: crypto.randomUUID(),
        items: [{ productId: crypto.randomUUID() }],
      });
    expect(res.status).toBe(400);
    const texto = (Array.isArray(res.body.message)
      ? res.body.message
      : [res.body.message]
    ).join(' | ');
    expect(texto).not.toMatch(/should not be empty|must be|should not exist/);
    expect(texto).toContain('obligatorio');
  });

  it('texto demasiado largo (MaxLength) → español con el límite', async () => {
    const res = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: crypto.randomUUID(),
        codigo: 'X-1',
        descripcion: 'x'.repeat(300),
      });
    expect(res.status).toBe(400);
    const texto = (Array.isArray(res.body.message)
      ? res.body.message
      : [res.body.message]
    ).join(' | ');
    expect(texto).toContain("El campo 'descripcion' no puede superar 250 caracteres");
  });
});
