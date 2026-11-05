import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I68 — corrección de pedidos en Pendiente_Corrección:
 *  - El Generador y el Administrador pueden cambiar el CLIENTE y el VENDEDOR
 *    del pedido; al cambiar el cliente, la dirección de despacho se
 *    recalcula con la principal del nuevo cliente.
 *  - El Operador (creador) solo puede cambiar los productos: si intenta
 *    cambiar cliente o vendedor recibe 403 y el pedido no se altera.
 *  - Reenviar los mismos valores de cliente/vendedor no cuenta como cambio.
 *  - La dirección elegida debe pertenecer al cliente (nuevo) del pedido.
 */
describe('I68 corrección con cambio de cliente y vendedor (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let clienteAId: string;
  let clienteBId: string;
  let direccionAId: string;
  let comercialAId: string;
  let comercialBId: string;
  let pedidoId: string;

  const itemsPedido = [{ referencia: 'I68-001', cantidad: 2 }];

  async function corregir(token: string, body: Record<string, unknown>) {
    return t.http
      .patch(`/api/v1/orders/${pedidoId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ items: itemsPedido, ...body });
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);

    for (const [username, rol] of [
      ['generador.i68', 'GENERADOR'],
      ['operador.i68', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i68', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i68', 'ClaveInicial1', 'ClaveNueva123');

    const emp = await t.http.get('/api/v1/companies').set('Authorization', `Bearer ${adminToken}`);
    ireId = emp.body.find((c: any) => c.nombre === 'IRE').id;

    const cliA = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente I68 A', identificacion: '900-I68-A', ciudad: 'Bogotá' });
    expect(cliA.status).toBe(201);
    clienteAId = cliA.body.id;

    const cliB = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente I68 B', identificacion: '900-I68-B', ciudad: 'Pereira' });
    expect(cliB.status).toBe(201);
    clienteBId = cliB.body.id;

    // Dirección del cliente A (para la prueba de pertenencia)…
    const dirA = await t.http
      .post(`/api/v1/clients/${clienteAId}/direcciones`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ direccion: 'Calle A #1-01', ciudad: 'Bogotá', esPrincipal: true });
    expect(dirA.status).toBe(201);
    direccionAId = dirA.body.id;

    // …y la principal del cliente B (la que debe quedar al cambiar de cliente)
    const dirB = await t.http
      .post(`/api/v1/clients/${clienteBId}/direcciones`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ direccion: 'Calle B #2-02', ciudad: 'Pereira', esPrincipal: true });
    expect(dirB.status).toBe(201);

    for (const [nombre, id] of [
      ['Comercial I68 A', 'C-I68-A'],
      ['Comercial I68 B', 'C-I68-B'],
    ] as const) {
      const com = await t.http
        .post('/api/v1/comerciales')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nombre, identificacion: id });
      expect(com.status).toBe(201);
      if (id === 'C-I68-A') comercialAId = com.body.id;
      else comercialBId = com.body.id;
    }

    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo: 'I68-001',
        descripcion: 'Producto I68',
        unidadMedida: 'UND',
        precio: 9000,
      });
    expect(prod.status).toBe(201);
    await t.dataSource.query(`UPDATE products SET cantidad=50 WHERE id=$1`, [prod.body.id]);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('el Operador crea el pedido y lo reporta → Pendiente_Corrección', async () => {
    const creado = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        empresaId: ireId,
        clienteId: clienteAId,
        comercialId: comercialAId,
        direccionId: direccionAId,
        items: itemsPedido,
      });
    expect(creado.status).toBe(201);
    expect(creado.body.numero).toBe('IRE-0001');
    expect(creado.body.direccionDespacho).toBe('Calle A #1-01');
    pedidoId = creado.body.id;

    const rep = await t.http
      .post(`/api/v1/orders/${pedidoId}/reportar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(rep.status).toBe(201);
    expect(rep.body.estado).toBe('PENDIENTE_CORRECCION');
  });

  it('el Operador NO puede cambiar el cliente ni el vendedor (403) y el pedido no se altera', async () => {
    const cambiaCliente = await corregir(operadorToken, { clienteId: clienteBId });
    expect(cambiaCliente.status).toBe(403);

    const cambiaComercial = await corregir(operadorToken, { comercialId: comercialBId });
    expect(cambiaComercial.status).toBe(403);

    const detalle = await t.http
      .get(`/api/v1/orders/${pedidoId}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(detalle.body.estado).toBe('PENDIENTE_CORRECCION');
    expect(detalle.body.clienteId).toBe(clienteAId);
    expect(detalle.body.comercialId).toBe(comercialAId);
    expect(detalle.body.direccionDespacho).toBe('Calle A #1-01');
  });

  it('el Operador sí corrige los productos (con la misma cabecera reenviada)', async () => {
    // Reenviar cliente/vendedor sin cambiarlos no cuenta como cambio
    const res = await corregir(operadorToken, {
      clienteId: clienteAId,
      comercialId: comercialAId,
      items: [{ referencia: 'I68-001', cantidad: 3 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('ABIERTO');
    expect(res.body.items[0].cantidad).toBe(3);
    expect(res.body.clienteId).toBe(clienteAId);
    expect(res.body.comercialId).toBe(comercialAId);
  });

  it('el Generador cambia cliente y vendedor; la dirección se recalcula con la del nuevo cliente', async () => {
    const rep = await t.http
      .post(`/api/v1/orders/${pedidoId}/reportar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(rep.body.estado).toBe('PENDIENTE_CORRECCION');

    const res = await corregir(generadorToken, {
      clienteId: clienteBId,
      comercialId: comercialBId,
    });
    expect(res.status).toBe(200);
    expect(res.body.estado).toBe('ABIERTO');
    expect(res.body.clienteId).toBe(clienteBId);
    expect(res.body.cliente?.nombre).toBe('Cliente I68 B');
    expect(res.body.comercialId).toBe(comercialBId);
    // Sin dirección explícita: la principal del nuevo cliente
    expect(res.body.direccionDespacho).toBe('Calle B #2-02');
  });

  it('la dirección elegida debe pertenecer al cliente del pedido (400 si es de otro)', async () => {
    const rep = await t.http
      .post(`/api/v1/orders/${pedidoId}/reportar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(rep.body.estado).toBe('PENDIENTE_CORRECCION');

    // La dirección del cliente A ya no pertenece al cliente B
    const res = await corregir(generadorToken, { direccionId: direccionAId });
    expect(res.status).toBe(400);

    const detalle = await t.http
      .get(`/api/v1/orders/${pedidoId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(detalle.body.estado).toBe('PENDIENTE_CORRECCION');
    expect(detalle.body.direccionDespacho).toBe('Calle B #2-02');

    // Vuelve a Abierto para cerrar el ciclo del pedido
    const ok = await corregir(generadorToken, {});
    expect(ok.status).toBe(200);
    expect(ok.body.estado).toBe('ABIERTO');
  });

  it('el cambio de cliente/vendedor queda en auditoría con antes y después', async () => {
    const aud = await t.http
      .get('/api/v1/audit?tabla=Pedidos&accion=PEDIDO_CORREGIDO&limit=50')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(aud.status).toBe(200);
    const registros = (aud.body.data ?? []).filter(
      (r: any) => r.registroId === pedidoId,
    );
    const conCambio = registros.find(
      (r: any) => r.valorNuevo?.clienteId === clienteBId,
    );
    expect(conCambio).toBeDefined();
    expect(conCambio.valorAnterior.clienteId).toBe(clienteAId);
    expect(conCambio.valorAnterior.comercialId).toBe(comercialAId);
    expect(conCambio.valorNuevo.comercialId).toBe(comercialBId);
    expect(conCambio.valorNuevo.direccionDespacho).toBe('Calle B #2-02');
  });
});
