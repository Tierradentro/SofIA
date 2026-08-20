import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

// PNG 1x1 válido
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * I2 — HU-006 Logo, HU-007 Etiqueta 50×30, M14 Parámetros.
 */
describe('Documentos y parámetros (e2e)', () => {
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
        nombre: 'Operador Docs',
        username: 'operador.docs',
        email: 'operador.docs@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    operadorToken = await loginAndSetPassword(
      t.http, 'operador.docs', 'ClaveInicial1', 'OperadorClave9',
    );
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('HU-006: carga de logo PNG válido y servido públicamente', async () => {
    const res = await t.http
      .post('/api/v1/documents/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', PNG_1PX, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(201);
    expect(res.body.tipo).toBe('LOGO');
    expect(res.body.esTemporal).toBe(false);

    const pub = await t.http.get('/api/v1/documents/logo');
    expect(pub.status).toBe(200);
    expect(pub.headers['content-type']).toContain('image/png');

    // Auditado
    const logs = await t.dataSource.query(
      `SELECT accion FROM audit_logs WHERE accion='CONFIGURAR_LOGO'`,
    );
    expect(logs.length).toBe(1);
  });

  it('HU-006: rechaza archivo que no es imagen', async () => {
    const res = await t.http
      .post('/api/v1/documents/logo')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('file', Buffer.from('no es imagen'), {
        filename: 'logo.txt',
        contentType: 'text/plain',
      });
    expect(res.status).toBe(400);
  });

  it('RBAC negativo: Operador recibe 403 al configurar el logo', async () => {
    const res = await t.http
      .post('/api/v1/documents/logo')
      .set('Authorization', `Bearer ${operadorToken}`)
      .attach('file', PNG_1PX, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(403);
  });

  it('HU-007: etiqueta 50×30 mm para el diálogo de impresión del navegador', async () => {
    const res = await t.http
      .get('/api/v1/documents/label?boxCode=CAJA-0001&barcode=data:image/png;base64,AAA')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('size: 50mm 30mm');
    expect(res.text).toContain('window.print()');
    expect(res.text).toContain('CAJA-0001');

    // Imagen inválida (no es data URL de imagen) → 400
    const bad = await t.http
      .get('/api/v1/documents/label?boxCode=CAJA-0001&barcode=http://evil')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(bad.status).toBe(400);
  });

  it('M14: consulta y actualización de parámetros con validación y auditoría', async () => {
    const list = await t.http
      .get('/api/v1/admin/params')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const claves = list.body.map((p: any) => p.clave);
    expect(claves).toContain('security.password_policy');

    // Valor inválido → 400
    let res = await t.http
      .put('/api/v1/admin/params/api.rate_limit_per_minute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: { requests_per_minute: 0 }, motivo: 'prueba' });
    expect(res.status).toBe(400);

    // Sin motivo → 400
    res = await t.http
      .put('/api/v1/admin/params/api.rate_limit_per_minute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: { requests_per_minute: 30 } });
    expect(res.status).toBe(400);

    // Correcto → 200 y auditado
    res = await t.http
      .put('/api/v1/admin/params/api.rate_limit_per_minute')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ valor: { requests_per_minute: 30 }, motivo: 'Ajuste por carga' });
    expect(res.status).toBe(200);

    const logs = await t.dataSource.query(
      `SELECT valor_anterior, valor_nuevo, motivo FROM audit_logs WHERE accion='CONFIGURAR_PARAMETRO' AND registro_id='api.rate_limit_per_minute'`,
    );
    expect(logs.length).toBe(1);
    expect(logs[0].valor_anterior.requests_per_minute).toBe(20);
    expect(logs[0].valor_nuevo.requests_per_minute).toBe(30);
  });

  it('RBAC negativo: Operador recibe 403 en parámetros del sistema', async () => {
    const res = await t.http
      .get('/api/v1/admin/params')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(res.status).toBe(403);
  });
});
