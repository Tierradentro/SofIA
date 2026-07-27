import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I13 (B-6, spec §11): exports CSV de los 5 listados generales — productos,
 * pedidos, despachos, cliente-pedidos-despachos e inventarios — con RBAC
 * (solo Generador/Administrador) y auditoría de la exportación.
 */
describe('Exports CSV B-6 (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    const empresas = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;

    for (const [username, rol] of [
      ['generador.csv', 'GENERADOR'],
      ['operador.csv', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.csv', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.csv', 'ClaveInicial1', 'ClaveNueva123');

    // Datos mínimos: producto + cliente + pedido
    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo: 'CSV-001',
        descripcion: 'Producto CSV',
        unidadMedida: 'UND',
        precio: 1000,
      });
    expect(prod.status).toBe(201);
    await t.dataSource.query(`UPDATE products SET cantidad=10 WHERE id=$1`, [prod.body.id]);
    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente CSV', identificacion: '900555111', ciudad: 'Bogotá', direccion: 'C 1' });
    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial CSV', identificacion: 'C-CSV' });
    const ped = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        clienteId: cli.body.id,
        comercialId: com.body.id,
        items: [{ referencia: 'CSV-001', cantidad: 1 }],
      });
    expect(ped.status).toBe(201);
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  const endpoints: [string, string, string][] = [
    // [ruta, encabezado esperado, dato esperado]
    [`/api/v1/exports/products.csv?empresaId=`, 'codigo,descripcion', 'CSV-001'],
    ['/api/v1/exports/pedidos.csv', 'numero,empresa,cliente', 'Cliente CSV'],
    ['/api/v1/exports/despachos.csv', 'numero,cliente,estado,empresas', ''],
    ['/api/v1/exports/cliente-pedidos-despachos.csv', 'cliente,pedido,estado_pedido', 'Cliente CSV'],
    ['/api/v1/exports/inventarios.csv', 'numero,empresa,estado,producto', ''],
  ];

  it('los 5 listados responden CSV UTF-8 con encabezado y datos', async () => {
    for (const [ruta, encabezado, dato] of endpoints) {
      const url = ruta.endsWith('=') ? `${ruta}${ireId}` : ruta;
      const res = await t.http
        .get(url)
        .set('Authorization', `Bearer ${generadorToken}`)
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.on('data', (c: Buffer) => (data += c.toString('utf8')));
          r.on('end', () => cb(null, data));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.body).toContain(encabezado);
      if (dato) expect(res.body).toContain(dato);
    }

    // Auditoría de las exportaciones (regla transversal)
    const audit = await t.dataSource.query(
      `SELECT tabla, count(*)::int AS n FROM audit_logs
       WHERE accion='EXPORTACION_CSV' GROUP BY tabla`,
    );
    const tablas = audit.map((a: any) => a.tabla);
    expect(tablas).toContain('Pedidos');
    expect(tablas).toContain('Despachos');
    expect(tablas).toContain('Inventarios');
  });

  it('RBAC negativo: Operador no puede exportar', async () => {
    const res = await t.http
      .get('/api/v1/exports/pedidos.csv')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(res.status).toBe(403);
  });
});
