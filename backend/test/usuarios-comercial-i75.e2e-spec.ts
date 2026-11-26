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
 * I75/I77 — usuarios con rol COMERCIAL:
 *  - La asociación usuario↔comercial es SIEMPRE manual (el nombre del
 *    usuario NO es llave — I77 revierte la auto-asociación de I75).
 *  - Un comercial no admite dos usuarios comerciales activos (409).
 *  - Alcance fail-closed: sin comercial asociado no ve pedidos, despachos
 *    ni PQRS (listas vacías, detalles 404) y no puede crear pedidos.
 *  - Con comercial asociado solo alcanza sus pedidos (detalle,
 *    revertir-alistamiento y corrección responden 404 sobre ajenos).
 */
describe('I75/I77 — usuarios comerciales (e2e)', () => {
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
        username: `comercial.i77.${seq}`,
        email: `comercial.i77.${seq}@sofia.local`,
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
        nombre: 'Generador I77',
        username: 'generador.i77',
        email: 'generador.i77@sofia.local',
        rol: 'GENERADOR',
        claveInicial: 'ClaveInicial1',
      });
    generadorToken = await login('generador.i77');

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({ nombre: 'Cliente I77', identificacion: '800-I77' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;

    for (const [nombre, ident] of [
      ['Comercial Alfa', 'I77-A'],
      ['Comercial Beta', 'I77-B'],
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
        codigo: 'I77-001',
        descripcion: 'Producto I77',
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
          items: [{ referencia: 'I77-001', cantidad: 1 }],
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

  it('el nombre NO es llave: sin comercialId el usuario queda sin asociar', async () => {
    const res = await crearUsuarioComercial('Comercial Alfa'); // nombre idéntico al comercial
    expect(res.status).toBe(201);
    expect(res.body.comercialId).toBeNull();
    expect(res.body.asociacionComercial.estado).toBe('SIN_ASOCIAR');
  });

  it('MANUAL: comercialId explícito asocia y el usuario solo alcanza sus pedidos', async () => {
    const res = await crearUsuarioComercial('Usuario Del Alfa', { comercialId: comercialAlfaId });
    expect(res.status).toBe(201);
    expect(res.body.comercialId).toBe(comercialAlfaId);
    expect(res.body.asociacionComercial).toMatchObject({
      estado: 'MANUAL',
      comercialId: comercialAlfaId,
      comercialNombre: 'Comercial Alfa',
    });

    const token = await login('comercial.i77.2');

    // El login expone el comercialId (banner del tablero)
    const sesion = await t.http.post('/api/v1/auth/login').send({
      username: 'comercial.i77.2',
      password: 'ClaveNueva123',
      dispositivo: DISPOSITIVO_TEST,
    });
    expect(sesion.status).toBe(200);
    expect(sesion.body.usuario.comercialId).toBe(comercialAlfaId);

    // Detalle del pedido propio: 200
    const propio = await t.http
      .get(`/api/v1/orders/${pedidoAlfaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(propio.status).toBe(200);

    // Pedido de otro comercial: ni detalle ni mutaciones
    const ajeno = await t.http
      .get(`/api/v1/orders/${pedidoBetaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(ajeno.status).toBe(404);
    const revertir = await t.http
      .post(`/api/v1/orders/${pedidoBetaId}/revertir-alistamiento`)
      .set('Authorization', `Bearer ${token}`);
    expect(revertir.status).toBe(404);
    const corregir = await t.http
      .patch(`/api/v1/orders/${pedidoBetaId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: [{ referencia: 'I77-001', cantidad: 1 }] });
    expect(corregir.status).toBe(404);

    // El listado solo muestra sus pedidos
    const lista = await t.http
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`);
    expect(lista.status).toBe(200);
    const ids = lista.body.map((p: any) => p.id);
    expect(ids).toContain(pedidoAlfaId);
    expect(ids).not.toContain(pedidoBetaId);
  });

  it('un comercial ya asignado no admite un segundo usuario (409)', async () => {
    const res = await crearUsuarioComercial('Otro Del Alfa', { comercialId: comercialAlfaId });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('Comercial Alfa');
    expect(res.body.message).toContain('comercial.i77.2');
  });

  it('SIN_ASOCIAR: fail-closed — listas vacías, detalles 404 y no puede crear pedidos', async () => {
    const token = await login('comercial.i77.1'); // creado sin comercial
    for (const ruta of ['/api/v1/orders', '/api/v1/dispatches', '/api/v1/pqrs']) {
      const lista = await t.http.get(ruta).set('Authorization', `Bearer ${token}`);
      expect(lista.status).toBe(200);
      expect(lista.body).toEqual([]);
    }
    const detalle = await t.http
      .get(`/api/v1/orders/${pedidoAlfaId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detalle.status).toBe(404);
    const crear = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        empresaId: ireId,
        clienteId,
        items: [{ referencia: 'I77-001', cantidad: 1 }],
      });
    expect(crear.status).toBe(400);
  });

  it('PATCH: asignación posterior, conflicto por ocupación y desasociación', async () => {
    const usuarios = await t.http
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const pendiente = usuarios.body.find((u: any) => u.username === 'comercial.i77.1');

    // Asignación manual posterior (Comercial Beta está libre)
    const asignar = await t.http
      .patch(`/api/v1/users/${pendiente.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comercialId: comercialBetaId });
    expect(asignar.status).toBe(200);
    expect(asignar.body.comercialId).toBe(comercialBetaId);
    expect(asignar.body.asociacionComercial.estado).toBe('MANUAL');

    // Reasignar a un comercial ocupado (Alfa) → 409
    const ocupado = await t.http
      .patch(`/api/v1/users/${pendiente.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comercialId: comercialAlfaId });
    expect(ocupado.status).toBe(409);

    // Reafirmar el suyo no se bloquea a sí mismo
    const propio = await t.http
      .patch(`/api/v1/users/${pendiente.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comercialId: comercialBetaId });
    expect(propio.status).toBe(200);
    expect(propio.body.comercialId).toBe(comercialBetaId);

    // Desasociar explícito (null)
    const desasociar = await t.http
      .patch(`/api/v1/users/${pendiente.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comercialId: null });
    expect(desasociar.status).toBe(200);
    expect(desasociar.body.comercialId).toBeNull();
  });

  it('PATCH con comercialId inexistente → 400', async () => {
    const usuarios = await t.http
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`);
    const pendiente = usuarios.body.find((u: any) => u.username === 'comercial.i77.1');
    const res = await t.http
      .patch(`/api/v1/users/${pendiente.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ comercialId: '11111111-1111-1111-1111-111111111111' });
    expect(res.status).toBe(400);
  });
});
