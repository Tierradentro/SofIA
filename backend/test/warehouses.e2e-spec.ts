import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I32 (Fase 2 - Mapa 2D): bodega/pisos/pasillos/zonas/estantes, configuracion,
 * mapa con ocupacion, asignacion de ubicaciones y localizacion de productos.
 */
describe('Warehouses (e2e)', () => {
  let t: TestApp;
  let tokenAdmin: string;
  let tokenGenerador: string;
  let tokenOperador: string;
  let empresaId: string;
  let productoId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    tokenAdmin = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );

    await t.http.post('/api/v1/users').set('Authorization', `Bearer ${tokenAdmin}`).send({
      nombre: 'Generador Mapa', username: 'generador.mapa', email: 'generador.mapa@sofia.local',
      rol: 'GENERADOR', claveInicial: 'ClaveInicial1',
    });
    await t.http.post('/api/v1/users').set('Authorization', `Bearer ${tokenAdmin}`).send({
      nombre: 'Operador Mapa', username: 'operador.mapa', email: 'operador.mapa@sofia.local',
      rol: 'OPERADOR', claveInicial: 'ClaveInicial1',
    });
    tokenGenerador = await loginAndSetPassword(t.http, 'generador.mapa', 'ClaveInicial1', 'GeneradorClave9');
    tokenOperador = await loginAndSetPassword(t.http, 'operador.mapa', 'ClaveInicial1', 'OperadorClave9');

    const emp = await t.http.get('/api/v1/companies').set('Authorization', `Bearer ${tokenAdmin}`);
    empresaId = emp.body.find((c: any) => c.nombre === 'IRE').id;
    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({
        empresaId,
        codigo: 'MAPA-001',
        descripcion: 'Producto para mapa 2D',
        unidadMedida: 'UND',
        precio: 10000,
      });
    expect(prod.status).toBe(201);
    productoId = prod.body.id;
  }, 120000);

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('GET /warehouses/map devuelve la bodega semilla con 2 pisos, 3 pasillos por piso y zonas con estantes', async () => {
    const res = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenOperador}`);
    expect(res.status).toBe(200);
    expect(res.body.bodega.nombre).toBe('Bodega Principal');
    expect(res.body.pisos).toHaveLength(2);
    for (const piso of res.body.pisos) {
      expect(piso.pasillos).toHaveLength(3);
      const zonasConEstantes = piso.pasillos.flatMap((p: any) => p.zonas).filter((z: any) => z.estantes.length > 0);
      expect(zonasConEstantes).toHaveLength(6);
      for (const z of zonasConEstantes) expect(z.estantes).toHaveLength(5);
    }
    const piso1 = res.body.pisos.find((p: any) => p.numero === 1);
    expect(piso1.areas.length).toBe(4);
    expect(res.body.pisos.find((p: any) => p.numero === 2).areas).toHaveLength(0);
  });

  it('POST /warehouses/configure esta restringido a ADMINISTRADOR', async () => {
    const payload = {
      nombre: 'Bodega Principal',
      forma: 'RECTANGULO',
      anchoM: 40,
      altoM: 30,
      pisos: [{ numero: 1, tieneAreasFijas: true, pasillos: [{ numero: 1, zonas: [] }] }],
    };
    const gen = await t.http.post('/api/v1/warehouses/configure').set('Authorization', `Bearer ${tokenGenerador}`).send(payload);
    expect(gen.status).toBe(403);
    const op = await t.http.post('/api/v1/warehouses/configure').set('Authorization', `Bearer ${tokenOperador}`).send(payload);
    expect(op.status).toBe(403);
  });

  it('POST /warehouses/locations asigna producto a estante/nivel y el mapa refleja la ocupacion', async () => {
    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const rack = mapa.body.pisos[0].pasillos[0].zonas.find((z: any) => z.estantes.length > 0).estantes[0];
    const res = await t.http
      .post('/api/v1/warehouses/locations')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ productId: productoId, rackId: rack.id, nivel: 2, cantidad: 7, esOficial: true });
    expect(res.status).toBe(201);

    const mapa2 = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const rack2 = mapa2.body.pisos[0].pasillos[0].zonas.find((z: any) => z.estantes.length > 0).estantes[0];
    expect(rack2.cantidad).toBe(7);
    expect(rack2.nivelesOcupados).toBe(1);
    expect(rack2.ocupacion).toBeCloseTo(1 / rack2.niveles);
  });

  it('GET /warehouses/locate?q= localiza el producto por codigo con su estante y nivel', async () => {
    const res = await t.http.get('/api/v1/warehouses/locate').query({ q: 'mapa-001' }).set('Authorization', `Bearer ${tokenOperador}`);
    expect(res.status).toBe(200);
    expect(res.body.product.codigo).toBe('MAPA-001');
    expect(res.body.ubicaciones).toHaveLength(1);
    expect(res.body.ubicaciones[0].nivel).toBe(2);
    expect(res.body.ubicaciones[0].rack.zone.aisle.numero).toBe(1);
  });

  it('GET /warehouses/racks/:id devuelve niveles con productos y empresa', async () => {
    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const rack = mapa.body.pisos[0].pasillos[0].zonas.find((z: any) => z.estantes.length > 0).estantes[0];
    const res = await t.http.get(`/api/v1/warehouses/racks/${rack.id}`).set('Authorization', `Bearer ${tokenOperador}`);
    expect(res.status).toBe(200);
    expect(res.body.rack.niveles).toBe(rack.niveles);
    expect(res.body.niveles).toHaveLength(rack.niveles);
    const nivel2 = res.body.niveles.find((n: any) => n.nivel === 2);
    expect(nivel2.productos).toHaveLength(1);
    expect(nivel2.productos[0].codigo).toBe('MAPA-001');
    expect(nivel2.productos[0].cantidad).toBe(7);
    expect(nivel2.productos[0].empresa).toBe('IRE');
  });

  it('el mapa desglosa la ocupación por empresa y cuenta el tránsito', async () => {
    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(mapa.body.enTransito).toBe(0);
    const rack = mapa.body.pisos[0].pasillos[0].zonas.find((z: any) => z.estantes.length > 0).estantes[0];
    expect(rack.empresas).toHaveLength(1);
    expect(rack.empresas[0].cantidad).toBe(7);

    // Asignar en tránsito y verificar el contador global
    const res = await t.http
      .post('/api/v1/warehouses/locations')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ productId: productoId, transito: true, cantidad: 3 });
    expect(res.status).toBe(201);
    const mapa2 = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(mapa2.body.enTransito).toBe(3);
  });

  it('GET /warehouses/areas/:id devuelve los productos almacenados en el área', async () => {
    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const bahia = mapa.body.pisos[0].areas.find((a: any) => a.tipo === 'BAHIA_TEMPORAL');
    expect(bahia).toBeDefined();

    const asignar = await t.http
      .post('/api/v1/warehouses/locations')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ productId: productoId, areaId: bahia.id, cantidad: 4 });
    expect(asignar.status).toBe(201);

    const res = await t.http.get(`/api/v1/warehouses/areas/${bahia.id}`).set('Authorization', `Bearer ${tokenOperador}`);
    expect(res.status).toBe(200);
    expect(res.body.area.tipo).toBe('BAHIA_TEMPORAL');
    expect(res.body.productos).toHaveLength(1);
    expect(res.body.productos[0].codigo).toBe('MAPA-001');
    expect(res.body.productos[0].cantidad).toBe(4);

    // El mapa refleja la ocupación del área
    const mapa2 = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const bahia2 = mapa2.body.pisos[0].areas.find((a: any) => a.tipo === 'BAHIA_TEMPORAL');
    expect(bahia2.cantidad).toBe(4);
    expect(bahia2.empresas).toHaveLength(1);
  });

  it('valida reglas: nivel fuera de rango, ubicacion sin destino y mover cajon con alias', async () => {
    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const pasillo = mapa.body.pisos[0].pasillos[0];
    const rack = pasillo.zonas.find((z: any) => z.estantes.length > 0).estantes[0];

    const nivelMalo = await t.http
      .post('/api/v1/warehouses/locations')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ productId: productoId, rackId: rack.id, nivel: 99, cantidad: 1 });
    expect(nivelMalo.status).toBe(400);

    const sinDestino = await t.http
      .post('/api/v1/warehouses/locations')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ productId: productoId, cantidad: 1 });
    expect(sinDestino.status).toBe(400);

    const movido = await t.http
      .patch(`/api/v1/warehouses/pasillo/${pasillo.id}/posicion`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ posX: 5, posY: 10, alias: 'Pasillo central' });
    expect(movido.status).toBe(200);
    expect(movido.body.alias).toBe('Pasillo central');
    expect(movido.body.posX).toBe(5);
  });
});
