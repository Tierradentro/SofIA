import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I3 — M04 Clientes / M06 Comerciales (catálogos globales).
 * Lectura de detalle de cliente auditada (M15); RBAC: Operador no
 * crea/edita (403); asociación usuario-comercial solo rol COMERCIAL.
 */
describe('Clientes y Comerciales (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    for (const [username, rol] of [
      ['generador.cc', 'GENERADOR'],
      ['operador.cc', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.cc', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.cc', 'ClaveInicial1', 'ClaveNueva123');
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  let clienteId: string;

  it('M04: Generador crea cliente global (sin empresa) y queda auditado en tabla Clientes', async () => {
    const res = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        nombre: 'Autopartes El Carmen SAS',
        identificacion: '900.456.789-1',
        direccion: 'Cra 45 #12-30',
        telefonos: '601 555 1234',
        ciudad: 'Bogotá',
      });
    expect(res.status).toBe(201);
    clienteId = res.body.id;

    const logs = await t.dataSource.query(
      `SELECT accion, tabla FROM audit_logs WHERE tabla='Clientes' AND registro_id=$1 AND accion='CREAR'`,
      [clienteId],
    );
    expect(logs.length).toBe(1);
  });

  it('QA Func. 4.1: la dirección del alta migra como principal; CRUD de direcciones con máximo 10', async () => {
    // La dirección del formulario de creación quedó registrada como principal
    const lista = await t.http
      .get(`/api/v1/clients/${clienteId}/direcciones`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(lista.status).toBe(200);
    expect(lista.body.length).toBe(1);
    expect(lista.body[0].direccion).toBe('Cra 45 #12-30');
    expect(lista.body[0].esPrincipal).toBe(true);

    // Agregar una segunda dirección (no desplaza la principal)
    const segunda = await t.http
      .post(`/api/v1/clients/${clienteId}/direcciones`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ direccion: 'Calle 80 #20-15', ciudad: 'Medellín' });
    expect(segunda.status).toBe(201);
    expect(segunda.body.esPrincipal).toBe(false);

    // Marcarla como principal: la anterior deja de serlo (una sola principal)
    const marca = await t.http
      .patch(`/api/v1/clients/${clienteId}/direcciones/${segunda.body.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ esPrincipal: true });
    expect(marca.status).toBe(200);
    const despues = await t.http
      .get(`/api/v1/clients/${clienteId}/direcciones`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(despues.body.filter((d: any) => d.esPrincipal).length).toBe(1);
    expect(despues.body[0].id).toBe(segunda.body.id);

    // No se puede eliminar la principal
    const borrarPrincipal = await t.http
      .post(`/api/v1/clients/${clienteId}/direcciones/${segunda.body.id}/eliminar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(borrarPrincipal.status).toBe(400);

    // RBAC: Operador no administra direcciones
    const porOperador = await t.http
      .post(`/api/v1/clients/${clienteId}/direcciones`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ direccion: 'No debe crearse' });
    expect(porOperador.status).toBe(403);
  });

  it('QA Func. 4.1: máximo 10 direcciones por cliente', async () => {
    // Ya hay 2; agregar hasta el límite
    for (let i = 3; i <= 10; i++) {
      const r = await t.http
        .post(`/api/v1/clients/${clienteId}/direcciones`)
        .set('Authorization', `Bearer ${generadorToken}`)
        .send({ direccion: `Dirección ${i}` });
      expect(r.status).toBe(201);
    }
    const once = await t.http
      .post(`/api/v1/clients/${clienteId}/direcciones`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ direccion: 'La onceava no entra' });
    expect(once.status).toBe(400);
    expect(once.body.message).toContain('10');
  });

  it('M15: la lectura del detalle de cliente queda auditada (LECTURA); el listado no', async () => {
    const antes = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE accion='LECTURA'`,
    );

    await t.http
      .get('/api/v1/clients')
      .set('Authorization', `Bearer ${operadorToken}`);
    const despuesLista = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE accion='LECTURA'`,
    );
    expect(despuesLista[0].n).toBe(antes[0].n); // listados no auditan

    const detalle = await t.http
      .get(`/api/v1/clients/${clienteId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(detalle.status).toBe(200);
    const despuesDetalle = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE accion='LECTURA' AND tabla='Clientes' AND registro_id=$1`,
      [clienteId],
    );
    expect(despuesDetalle[0].n).toBe(1);
  });

  it('RBAC negativo: Operador recibe 403 al crear/editar clientes', async () => {
    const post = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ nombre: 'Cliente No Autorizado' });
    expect(post.status).toBe(403);

    const patch = await t.http
      .patch(`/api/v1/clients/${clienteId}`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ ciudad: 'Medellín' });
    expect(patch.status).toBe(403);
  });

  it('M04: edición por Generador auditada con valor anterior/nuevo', async () => {
    const res = await t.http
      .patch(`/api/v1/clients/${clienteId}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ telefonos: '601 555 9999' });
    expect(res.status).toBe(200);

    const logs = await t.dataSource.query(
      `SELECT valor_anterior, valor_nuevo FROM audit_logs WHERE tabla='Clientes' AND registro_id=$1 AND accion='EDITAR'`,
      [clienteId],
    );
    expect(logs.length).toBe(1);
    expect(logs[0].valor_anterior.telefonos).toBe('601 555 1234');
    expect(logs[0].valor_nuevo.telefonos).toBe('601 555 9999');
  });

  it('M06: comercial global + usuario rol Comercial asociado; asociación inválida rechazada', async () => {
    const comercial = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Juan Comercial', identificacion: '1.234.567' });
    expect(comercial.status).toBe(201);

    // Usuario COMERCIAL asociado → OK
    const user = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Usuario Comercial',
        username: 'comercial.user',
        email: 'comercial.user@sofia.local',
        rol: 'COMERCIAL',
        comercialId: comercial.body.id,
        claveInicial: 'ClaveInicial1',
      });
    expect(user.status).toBe(201);
    expect(user.body.comercialId).toBe(comercial.body.id);

    // Asociar comercial a un rol distinto → 400
    const invalido = await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Usuario Malo',
        username: 'comercial.malo',
        email: 'comercial.malo@sofia.local',
        rol: 'OPERADOR',
        comercialId: comercial.body.id,
        claveInicial: 'ClaveInicial1',
      });
    expect(invalido.status).toBe(400);
  });

  it('QA Func. 3.5: Generador recibe 403 al crear/editar comerciales; Administrador sigue pudiendo', async () => {
    const creado = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Admin', identificacion: '9.876.543' });
    expect(creado.status).toBe(201);

    const porGenerador = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ nombre: 'No Debe Crearse' });
    expect(porGenerador.status).toBe(403);

    const edicion = await t.http
      .patch(`/api/v1/comerciales/${creado.body.id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ nombre: 'Edición Bloqueada' });
    expect(edicion.status).toBe(403);

    const edicionAdmin = await t.http
      .patch(`/api/v1/comerciales/${creado.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial Admin Editado' });
    expect(edicionAdmin.status).toBe(200);
  });

  it('Consulta de clientes y comerciales disponible para roles operativos', async () => {
    const clients = await t.http
      .get('/api/v1/clients?q=Carmen')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(clients.status).toBe(200);
    expect(clients.body.length).toBe(1);

    const comerciales = await t.http
      .get('/api/v1/comerciales?q=Juan')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(comerciales.status).toBe(200);
    expect(comerciales.body.length).toBe(1);
  });
});
