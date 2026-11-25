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
 * I75 — Rol COMERCIAL: asociación usuario↔comercial con el nombre como
 * llave y cierre del alcance (fail-closed) cuando no hay comercial asociado.
 *
 * Cubre:
 *  - AUTO/MANUAL/SIN_COINCIDENCIA/AMBIGUA/YA_ASIGNADO en POST /users.
 *  - Asociación manual posterior con PATCH /users/:id (selector de la vista).
 *  - Listados y detalles de pedidos/despachos/PQRS limitados al comercial.
 *  - Sin comercial asociado: listas vacías y detalles 404 (antes veía todo).
 *  - revertir-alistamiento y correct no cruzan comerciales.
 */
describe('I75 — usuarios comerciales (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let ireId: string;
  let clienteId: string;
  let comercialAlfaId: string;
  let comercialBetaId: string;
  let pedidoAlfaId: string;
  let pedidoBetaId: string;
  let seq = 0;

  async function crearUsuarioComercial(nombre: string, extra: any = {}) {
    seq += 1;
    return t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre,
        username: `comercial.i75.${seq}`,
        email: `comercial.i75.${seq}@sofia.local`,
        rol: 'COMERCIAL',
        claveInicial: 'ClaveInicial1',
        ...extra,
      });
  }

  async function login(username: string) {
    return loginAndSetPassword(t.http, username, 'ClaveInicial1', 'ClaveNueva123');
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    const empresas = await t.dataSource.query(`SELECT id, nombre FROM companies`);
    ireId = empresas.find((e: any) => e.nombre === 'IRE').id;

    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Generador I75',
        username: 'generador.i75',
        email: 'generador.i75@sofia.local',
        rol: 'GENERADOR',
        claveInicial: 'ClaveInicial1',
      });
    generadorToken = await login('generador.i75');

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ nombre: 'Cliente I75', identificacion: '800-I75' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;

    for (const [nombre, ident] of [
      ['Comercial Alfa', 'I75-A'],
      ['Comercial Beta', 'I75-B'],
    ] as const) {
      const res = await t.http
        .post('/api/v1/comerciales')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre, identificacion: ident });
      expect(res.status).toBe(201);
      if (nombre === 'Comercial Alfa') comercialAlfaId = res.body.id;
      else comercialBetaId = res.body.id;
    }

    // Producto con stock y dos pedidos (uno por comercial)
    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo: 'I75-001',
        descripcion: 'Producto I75',
        unidadMedida: 'UND',
        precio: 5000,
      });
    expect(prod.status).toBe(201);
    await t.dataSource.query(`UPDATE products SET cantidad=100 WHERE id=$1`, [prod.body.id]);

    for (const [comercialId, destino] of [
      [comercialAlfaId, 'alfa'],
      [comercialBetaId, 'beta'],
    ] as const) {
      const p = await t.http
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${generadorToken}`)
        .send({
          empresaId: ireId,
          clienteId,
          comercialId,
          items: [{ referencia: 'I75-001', cantidad: 1 }],
        });
      expect(p.status).toBe(201);
      if (destino === 'alfa') pedidoAlfaId = p.body.id;
      else pedidoBetaId = p.body.id;
    }
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('AUTO: el nombre del usuario es la llave (ignora mayúsculas/tildes/espacios)', async () => {
    const res = await crearUsuarioComercial('  comercial   ALFA ');
    expect(res.status).toBe(201);
    expect(res.body.comercialId).toBe(comercialAlfaId);
    expect(res.body.asociacionComercial).toMatchObject({
      estado: 'AUTO',
      comercialId: comercialAlfaId,
      comercialNombre: 'Comercial Alfa',
    });
    // La asociación queda auditada
    const logs = await t.dataSource.query(
      `SELECT motivo FROM audit_logs WHERE tabla='users' AND registro_id=$1 AND accion='CREAR'`,
      [res.body.id],
    );
    expect(logs[0].motivo).toContain('Comercial Alfa');

    // El login expone el comercialId (banner del tablero)
    const token = await login('comercial.i75.1');
    const detalle = await t.http
      .get(`/api/v1/orders/${pedidoAlfaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detalle.status).toBe(200);

    // No alcanza el pedido de otro comercial ni por detalle…
    const ajeno = await t.http
      .get(`/api/v1/orders/${pedidoBetaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(ajeno.status).toBe(404);

    // …ni por revertir-alistamiento (I75: alcance en mutaciones)
    const revertir = await t.http
      .post(`/api/v1/orders/${pedidoBetaId}/revertir-alistamiento`)
      .set('Authorization', `Bearer ${token}`);
    expect(revertir.status).toBe(404);

    // …ni por corrección
    const corregir = await t.http
      .patch(`/api/v1/orders/${pedidoBetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ referencia: 'I75-001', cantidad: 1 }] });
    expect(corregir.status).toBe(404);

    // El listado solo muestra sus pedidos
    const lista = await t.http
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`);
    expect(lista.status).toBe(200);
    const numeros = lista.body.map((p: any) => p.id);
    expect(numeros).toContain(pedidoAlfaId);
    expect(numeros).not.toContain(pedidoBetaId);
  });

  it('YA_ASIGNADO: un comercial activo no admite un segundo usuario por nombre', async () => {
    const res = await crearUsuarioComercial('Comercial Alfa');
    expect(res.status).toBe(201);
    expect(res.body.comercialId).toBeNull();
    expect(res.body.asociacionComercial.estado).toBe('YA_ASIGNADO');
    expect(res.body.asociacionComercial.mensaje).toContain('comercial.i75.1');
  });

  it('SIN_COINCIDENCIA: sin comercial homónimo queda fail-closed (listas vacías, detalles 404)', async () => {
    const res = await crearUsuarioComercial('Vendedor Sin Catalogar');
    expect(res.status).toBe(201);
    expect(res.body.comercialId).toBeNull();
    expect(res.body.asociacionComercial.estado).toBe('SIN_COINCIDENCIA');

    const token = await login('comercial.i75.3');
    for (const ruta of ['/api/v1/orders', '/api/v1/dispatches', '/api/v1/pqrs']) {
      const lista = await t.http.get(ruta).set('Authorization', `Bearer ${token}`);
      expect(lista.status).toBe(200);
      expect(lista.body).toEqual([]);
    }
    const detalle = await t.http
      .get(`/api/v1/orders/${pedidoAlfaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detalle.status).toBe(404);
    // Tampoco puede crear pedidos (resolveComercial exige la asociación)
    const crear = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        empresaId: ireId,
        clienteId,
        items: [{ referencia: 'I75-001', cantidad: 1 }],
      });
    expect(crear.status).toBe(400);
  });

  it('AMBIGUA: dos comerciales activos con el mismo nombre no se adivinan', async () => {
    await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Duplicado I75', identificacion: 'I75-D1' });
    await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'duplicado i75', identificacion: 'I75-D2' });

    const res = await crearUsuarioComercial('Duplicado I75');
    expect(res.status).toBe(201);
    expect(res.body.comercialId).toBeNull();
    expect(res.body.asociacionComercial.estado).toBe('AMBIGUA');
  });

  it('MANUAL: comercialId explícito en creación y corrección posterior con PATCH', async () => {
    // Explícito válido (tiene prioridad sobre el nombre)
    const manual = await crearUsuarioComercial('Nombre Cualquiera', { comercialId: comercialBetaId });
    expect(manual.status).toBe(201);
    expect(manual.body.asociacionComercial.estado).toBe('MANUAL');
    expect(manual.body.comercialId).toBe(comercialBetaId);

    // Explícito inválido → 400 (antes 500 por la FK)
    const invalido = await crearUsuarioComercial('Otro Nombre', {
      comercialId: '11111111-1111-1111-1111-111111111111',
    });
    expect(invalido.status).toBe(400);

    // PATCH: desasociar explícito (null) y reasociar manualmente
    const desasociar = await t.http
      .patch(`/api/v1/users/${manual.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comercialId: null });
    expect(desasociar.status).toBe(200);
    expect(desasociar.body.comercialId).toBeNull();

    const reasociar = await t.http
      .patch(`/api/v1/users/${manual.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comercialId: comercialAlfaId });
    expect(reasociar.status).toBe(200);
    expect(reasociar.body.comercialId).toBe(comercialAlfaId);
    expect(reasociar.body.asociacionComercial.estado).toBe('MANUAL');
  });

  it('PATCH sin comercialId reintenta la llave por nombre (repara asociaciones)', async () => {
    // «Vendedor Sin Catalogar» (usuario 3) se renombra a un comercial existente
    const usuarios = await t.http
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const pendiente = usuarios.body.find((u: any) => u.username === 'comercial.i75.3');
    const res = await t.http
      .patch(`/api/v1/users/${pendiente.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Beta' });
    expect(res.status).toBe(200);
    expect(res.body.comercialId).toBe(comercialBetaId);
    expect(res.body.asociacionComercial.estado).toBe('AUTO');
  });

  it('el login del usuario comercial expone comercialId para el banner del tablero', async () => {
    const res = await t.http.post('/api/v1/auth/login').send({
      username: 'comercial.i75.1',
      password: 'ClaveNueva123',
      dispositivo: DISPOSITIVO_TEST,
    });
    expect(res.status).toBe(200);
    expect(res.body.usuario.comercialId).toBe(comercialAlfaId);
  });
});
