import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I67 — borradores de pedido (anti desconexión / apagón):
 *  - El formulario de «Nuevo pedido» se guarda automáticamente como
 *    borrador SIN número de pedido (el consecutivo SIGLAS-#### solo se
 *    asigna al confirmar).
 *  - El borrador es personal: otro usuario no lo ve ni lo toca (404).
 *  - Confirmar crea el pedido real (ABIERTO, consecutivo siguiente) y
 *    elimina el borrador; si la confirmación falla, el borrador se conserva.
 *  - El borrador admite datos parciales (sin validación estricta).
 */
describe('I67 borradores de pedido (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let generadorToken: string;
  let operadorToken: string;
  let ireId: string;
  let clienteId: string;
  let comercialId: string;

  const payloadBorrador = (items: any[]) => ({
    via: 'MANUAL',
    clienteId,
    comercialId,
    ciudad: 'Bogotá',
    notas: 'Digitación en curso',
    items,
  });

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);

    for (const [username, rol] of [
      ['generador.i67', 'GENERADOR'],
      ['operador.i67', 'OPERADOR'],
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
    generadorToken = await loginAndSetPassword(t.http, 'generador.i67', 'ClaveInicial1', 'ClaveNueva123');
    operadorToken = await loginAndSetPassword(t.http, 'operador.i67', 'ClaveInicial1', 'ClaveNueva123');

    const emp = await t.http.get('/api/v1/companies').set('Authorization', `Bearer ${adminToken}`);
    ireId = emp.body.find((c: any) => c.nombre === 'IRE').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Cliente I67', identificacion: '900-I67', ciudad: 'Bogotá' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;

    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ nombre: 'Comercial I67', identificacion: 'C-I67' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        codigo: 'I67-001',
        descripcion: 'Producto I67',
        unidadMedida: 'UND',
        precio: 12000,
      });
    expect(prod.status).toBe(201);
    await t.dataSource.query(`UPDATE products SET cantidad=50 WHERE id=$1`, [prod.body.id]);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('guarda un borrador sin crear pedido ni consumir consecutivo', async () => {
    const antes = await t.http
      .get(`/api/v1/orders?empresaId=${ireId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    const totalAntes = antes.body.length;

    const res = await t.http
      .post('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        payload: payloadBorrador([
          { referencia: 'I67-001', descripcion: 'Producto I67', cantidad: '2', valorUnidad: '12000' },
          // Fila a medio digitar: el borrador la admite tal cual
          { referencia: '', descripcion: 'escribiendo…', cantidad: '1', valorUnidad: '' },
        ]),
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();

    // No aparece en el listado de pedidos ni consume número
    const despues = await t.http
      .get(`/api/v1/orders?empresaId=${ireId}`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(despues.body.length).toBe(totalAntes);

    // El siguiente pedido real conserva el consecutivo que le corresponde
    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        clienteId,
        comercialId,
        items: [{ referencia: 'I67-001', cantidad: 1 }],
      });
    expect(pedido.status).toBe(201);
    expect(pedido.body.numero).toBe('IRE-0001');

    // El listado de borradores muestra el resumen (2 filas con contenido)
    const lista = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(lista.status).toBe(200);
    expect(lista.body.length).toBe(1);
    expect(lista.body[0].productos).toBe(2); // las dos filas tienen contenido
    expect(lista.body[0].empresaId).toBe(ireId);
  });

  it('actualiza el borrador con el guardado automático sucesivo (PUT)', async () => {
    const lista = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${generadorToken}`);
    const id = lista.body[0].id;

    const put = await t.http
      .put(`/api/v1/orders/drafts/${id}`)
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: ireId,
        payload: payloadBorrador([
          { referencia: 'I67-001', descripcion: 'Producto I67', cantidad: '5', valorUnidad: '11500' },
        ]),
      });
    expect(put.status).toBe(200);

    const despues = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(despues.body.length).toBe(1);
    expect(despues.body[0].payload.items[0].cantidad).toBe('5');
  });

  it('el borrador es personal: otro usuario no lo ve ni lo modifica (404)', async () => {
    const listaAjena = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(listaAjena.status).toBe(200);
    expect(listaAjena.body.length).toBe(0);

    const lista = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${generadorToken}`);
    const id = lista.body[0].id;

    const putAjeno = await t.http
      .put(`/api/v1/orders/drafts/${id}`)
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({ payload: {} });
    expect(putAjeno.status).toBe(404);

    const confirmarAjeno = await t.http
      .post(`/api/v1/orders/drafts/${id}/confirmar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(confirmarAjeno.status).toBe(404);

    const borrarAjeno = await t.http
      .delete(`/api/v1/orders/drafts/${id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(borrarAjeno.status).toBe(404);
  });

  it('confirmar crea el pedido con el consecutivo siguiente y elimina el borrador', async () => {
    const lista = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${generadorToken}`);
    const id = lista.body[0].id;

    const conf = await t.http
      .post(`/api/v1/orders/drafts/${id}/confirmar`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(conf.status).toBe(201);
    expect(conf.body.numero).toBe('IRE-0002');
    expect(conf.body.estado).toBe('ABIERTO');
    expect(conf.body.items.length).toBe(1);
    expect(conf.body.items[0].cantidad).toBe(5);
    expect(Number(conf.body.items[0].valorUnidad)).toBe(11500);
    expect(conf.body.notas).toBe('Digitación en curso');

    // El borrador ya no existe
    const despues = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(despues.body.length).toBe(0);
  });

  it('si la confirmación falla por validación, el borrador se conserva', async () => {
    // Borrador sin cliente: confirma → 400 y el borrador sigue ahí
    const res = await t.http
      .post('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        empresaId: ireId,
        payload: { via: 'MANUAL', items: [{ referencia: 'I67-001', cantidad: '1' }] },
      });
    expect(res.status).toBe(201);

    const conf = await t.http
      .post(`/api/v1/orders/drafts/${res.body.id}/confirmar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(conf.status).toBe(400);

    const lista = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(lista.body.length).toBe(1);

    // Descartar lo elimina
    const del = await t.http
      .delete(`/api/v1/orders/drafts/${res.body.id}`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(del.status).toBe(200);
    const final = await t.http
      .get('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(final.body.length).toBe(0);
  });

  it('el rol Operador también guarda y confirma borradores', async () => {
    const res = await t.http
      .post('/api/v1/orders/drafts')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        empresaId: ireId,
        payload: payloadBorrador([
          { referencia: 'I67-001', cantidad: '3', valorUnidad: '' },
        ]),
      });
    expect(res.status).toBe(201);

    const conf = await t.http
      .post(`/api/v1/orders/drafts/${res.body.id}/confirmar`)
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(conf.status).toBe(201);
    expect(conf.body.numero).toBe('IRE-0003');
    // Sin valorUnidad en el ítem, toma el precio del producto (12000)
    expect(Number(conf.body.items[0].valorUnidad)).toBe(12000);
  });
});
