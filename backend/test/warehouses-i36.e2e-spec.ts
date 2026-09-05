import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

// I36: sin caché del horario de logística en el guard (determinismo de pruebas)
process.env.HORARIO_CACHE_MS = '0';

/**
 * I36 — ajustes de la iteración 36:
 *  - Áreas fijas: solo entrada, patio de maniobras y bahía de empaque
 *    (la bahía temporal es opcional/eliminable).
 *  - La bahía de empaque se recrea sola si no existe o fue eliminada:
 *    al guardar la configuración y al alistar un pedido.
 *  - Al finalizar el alistamiento la mercancía queda ubicada en la bahía
 *    de empaque; al cerrar la caja del despacho sale del área y de la
 *    bodega; al cancelar el despacho regresa.
 *  - Geometría fraccionaria de pasillos aceptada (posX/anchoM decimales).
 *  - Horario de logística: control de acceso por días y franja horaria
 *    (administrador exento).
 *  - GET /health reporta el estado de las migraciones (showMigrations).
 *  - GET /api/box/:boxId (API externa) devuelve solo campos públicos.
 */
describe('I36 ajustes (e2e)', () => {
  let t: TestApp;
  let tokenAdmin: string;
  let tokenGenerador: string;
  let tokenOperador: string;
  let apiKey: string;
  let empresaId: string;
  let clienteId: string;
  let comercialId: string;

  const CLAVE_HORARIO = 'logistica.horario_acceso';

  /** Índice del día de hoy en America/Bogota (0 = domingo). */
  function hoyEnBogota(): number {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Bogota',
      weekday: 'short',
    }).format(new Date());
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  }

  async function ubicacionesDe(productoId: string) {
    return t.dataSource.query(
      `SELECT l.cantidad, l.es_oficial AS "esOficial", l.rack_id AS "rackId",
              a.tipo AS "tipoArea", a.activo AS "areaActiva"
         FROM warehouse_product_locations l
         LEFT JOIN warehouse_areas a ON a.id = l.area_id
        WHERE l.product_id = $1
        ORDER BY l.created_at`,
      [productoId],
    );
  }

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    tokenAdmin = await loginAndSetPassword(t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE);

    for (const [username, rol] of [
      ['generador.i36', 'GENERADOR'],
      ['operador.i36', 'OPERADOR'],
      ['integracion.i36', 'API'],
    ] as const) {
      await t.http
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          nombre: `Usuario ${username}`,
          username,
          email: `${username}@sofia.local`,
          rol,
          claveInicial: 'ClaveInicial1',
        });
    }
    tokenGenerador = await loginAndSetPassword(t.http, 'generador.i36', 'ClaveInicial1', 'GeneradorClave9');
    tokenOperador = await loginAndSetPassword(t.http, 'operador.i36', 'ClaveInicial1', 'OperadorClave9');

    const emp = await t.http.get('/api/v1/companies').set('Authorization', `Bearer ${tokenAdmin}`);
    empresaId = emp.body.find((c: any) => c.nombre === 'IRE').id;

    const cli = await t.http
      .post('/api/v1/clients')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Cliente I36', identificacion: '900-I36', ciudad: 'Bogotá' });
    expect(cli.status).toBe(201);
    clienteId = cli.body.id;

    const com = await t.http
      .post('/api/v1/comerciales')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ nombre: 'Comercial I36', identificacion: 'C-I36' });
    expect(com.status).toBe(201);
    comercialId = com.body.id;

    const apiUser = await t.dataSource.query(`SELECT id FROM users WHERE username='integracion.i36'`);
    const key = await t.http
      .post('/api/v1/api-keys')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ userId: apiUser[0].id, nombre: 'ERP I36' });
    expect(key.status).toBe(201);
    expect(key.body.clave).toMatch(/^sk_/);
    apiKey = key.body.clave;
  }, 120000);

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('configure: las áreas fijas son exactamente 3 y acepta geometría fraccionaria', async () => {
    const payload = {
      nombre: 'Bodega I36',
      forma: 'RECTANGULO',
      anchoM: 40,
      altoM: 30,
      pisos: [
        {
          numero: 1,
          tieneAreasFijas: true,
          pasillos: [
            {
              numero: 1,
              // I36: el asistente reparte el ancho útil y puede dar decimales
              posX: 14.667,
              posY: 2,
              anchoM: 10.667,
              altoM: 20,
              zonas: [
                {
                  lado: 'IZQUIERDA',
                  estantes: [
                    { numero: 1, niveles: 3 },
                    { numero: 2, niveles: 4 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    const res = await t.http
      .post('/api/v1/warehouses/configure')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send(payload);
    expect(res.status).toBe(201);

    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(mapa.status).toBe(200);
    const piso1 = mapa.body.pisos.find((p: any) => p.numero === 1);
    const tipos = piso1.areas.map((a: any) => a.tipo).sort();
    expect(tipos).toEqual(['BAHIA_EMPAQUE', 'ENTRADA', 'PATIO_MANIOBRAS']);

    // La geometría fraccionaria y los niveles por estante quedan guardados
    const pasillo = piso1.pasillos[0];
    expect(pasillo.posX).toBeCloseTo(14.667, 3);
    expect(pasillo.anchoM).toBeCloseTo(10.667, 3);
    const estantes = pasillo.zonas.find((z: any) => z.lado === 'IZQUIERDA').estantes;
    expect(estantes.map((e: any) => e.niveles)).toEqual([3, 4]);
  });

  it('configure sin áreas fijas recrea la bahía de empaque automáticamente', async () => {
    const res = await t.http
      .post('/api/v1/warehouses/configure')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: 'Bodega I36',
        forma: 'RECTANGULO',
        anchoM: 40,
        altoM: 30,
        pisos: [
          {
            numero: 1,
            tieneAreasFijas: false,
            areas: [],
            pasillos: [{ numero: 1, zonas: [{ lado: 'FONDO', estantes: [] }] }],
          },
        ],
      });
    expect(res.status).toBe(201);

    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const piso1 = mapa.body.pisos.find((p: any) => p.numero === 1);
    const empaque = piso1.areas.filter((a: any) => a.tipo === 'BAHIA_EMPAQUE');
    expect(empaque).toHaveLength(1);
    expect(empaque[0].permiteProductos).toBe(true);
    // Sin áreas fijas: no hay entrada ni patio
    expect(piso1.areas).toHaveLength(1);
  });

  it('alistar ubica en bahía de empaque; cerrar caja la saca; cancelar la repone', async () => {
    // "Se eliminó": se desactiva la bahía de empaque antes de alistar; el
    // flujo la debe recrear solo (nunca bloquea la operación).
    await t.dataSource.query(`UPDATE warehouse_areas SET activo = false WHERE tipo = 'BAHIA_EMPAQUE'`);

    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({
        empresaId,
        codigo: 'E36-001',
        descripcion: 'Producto empaque I36',
        unidadMedida: 'UND',
        precio: 9000,
      });
    expect(prod.status).toBe(201);
    const productoId = prod.body.id;
    await t.dataSource.query(`UPDATE products SET cantidad = 20 WHERE id = $1`, [productoId]);
    const bc = await t.http
      .post(`/api/v1/products/${productoId}/barcode`)
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ barcode: '7501036001', origen: 'MANUAL' });
    expect(bc.status).toBe(201);

    const pedido = await t.http
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({
        empresaId,
        clienteId,
        comercialId,
        items: [{ referencia: 'E36-001', cantidad: 3 }],
      });
    expect(pedido.status).toBe(201);
    const orderId = pedido.body.id;

    const scan = await t.http
      .post(`/api/v1/orders/${orderId}/scan`)
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ modo: 'COMPLETO', codigo: '7501036001', cantidad: 3 });
    expect(scan.status).toBe(201);
    const fin = await t.http
      .post(`/api/v1/orders/${orderId}/finalizar-picking`)
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(fin.status).toBe(201);

    // La mercancía alistada quedó en una bahía de empaque (re)creada y activa
    const trasAlistar = await ubicacionesDe(productoId);
    expect(trasAlistar).toHaveLength(1);
    expect(trasAlistar[0].tipoArea).toBe('BAHIA_EMPAQUE');
    expect(trasAlistar[0].areaActiva).toBe(true);
    expect(trasAlistar[0].cantidad).toBe(3);
    expect(trasAlistar[0].esOficial).toBe(true);

    // Aprueba el pedido y crea el despacho completo hasta cerrar la caja
    await t.dataSource.query(
      `UPDATE orders SET estado='APROBADO', aprobado_at=now() WHERE id=$1`,
      [orderId],
    );
    const desp = await t.http
      .post('/api/v1/dispatches')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ orderId });
    expect(desp.status).toBe(201);
    const dispatchId = desp.body.id;
    const ap = await t.http
      .post(`/api/v1/dispatches/${dispatchId}/aprobar`)
      .set('Authorization', `Bearer ${tokenGenerador}`);
    expect(ap.status).toBe(201);

    const caja = await t.http
      .post(`/api/v1/dispatches/${dispatchId}/boxes`)
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(caja.status).toBe(201);
    const scanCaja = await t.http
      .post(`/api/v1/dispatches/${dispatchId}/boxes/${caja.body.id}/scan`)
      .set('Authorization', `Bearer ${tokenOperador}`)
      .send({ codigo: '7501036001', cantidad: 3 });
    expect(scanCaja.status).toBe(201);

    // Al cerrar la caja la mercancía sale del área y de la bodega
    const cierre = await t.http
      .post(`/api/v1/dispatches/${dispatchId}/boxes/${caja.body.id}/cerrar`)
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(cierre.status).toBe(201);
    const trasCierre = await ubicacionesDe(productoId);
    expect(trasCierre).toHaveLength(0);
    const [stockCerrado] = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE id=$1`,
      [productoId],
    );
    expect(stockCerrado.cantidad).toBe(17);

    // API externa: la consulta de caja expone solo campos públicos
    const consulta = await t.http
      .get(`/api/v1/api/box/${caja.body.boxId}`)
      .set('X-API-Key', apiKey);
    expect(consulta.status).toBe(200);
    expect(consulta.body.boxId).toBe(caja.body.boxId);
    expect(consulta.body.estado).toBe('CERRADA');
    expect(consulta.body.despacho.numero).toBe(desp.body.numero);
    expect(consulta.body.items).toHaveLength(1);
    const item = consulta.body.items[0];
    expect(item.codigo).toBe('E36-001');
    expect(item.cantidad).toBe(3);
    // Sin identificadores internos ni campos de auditoría
    expect(item.id).toBeUndefined();
    expect(item.boxId).toBeUndefined();
    expect(item.orderItemId).toBeUndefined();
    expect(item.productId).toBeUndefined();
    expect(consulta.body.id).toBeUndefined();

    // Cancelar el despacho: la mercancía regresa a la bahía de empaque
    const cancel = await t.http
      .post(`/api/v1/dispatches/${dispatchId}/cancelar`)
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ motivo: 'Prueba I36 de reversa a empaque' });
    expect(cancel.status).toBe(201);
    const trasCancelar = await ubicacionesDe(productoId);
    expect(trasCancelar).toHaveLength(1);
    expect(trasCancelar[0].tipoArea).toBe('BAHIA_EMPAQUE');
    expect(trasCancelar[0].cantidad).toBe(3);
    const [stockFinal] = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE id=$1`,
      [productoId],
    );
    expect(stockFinal.cantidad).toBe(20);
  });

  it('horario de logística: bloquea al operador fuera del horario; el admin entra siempre', async () => {
    // Franja válida todos los días EXCEPTO hoy (Bogotá) → hoy está bloqueado
    const hoy = hoyEnBogota();
    const dias = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== hoy);
    const activar = await t.http
      .put(`/api/v1/admin/params/${CLAVE_HORARIO}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        valor: {
          activo: true,
          dias,
          horaInicio: '00:00',
          horaFin: '23:59',
          zonaHoraria: 'America/Bogota',
        },
        motivo: 'Prueba I36 de control de acceso',
      });
    expect(activar.status).toBe(200);

    // Petición con token vigente del operador → 403 FUERA_DE_HORARIO
    const bloqueado = await t.http
      .get('/api/v1/warehouses/map')
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(bloqueado.status).toBe(403);
    expect(bloqueado.body.code).toBe('FUERA_DE_HORARIO');

    // El inicio de sesión también se bloquea y queda auditado
    const login = await t.http
      .post('/api/v1/auth/login')
      .send({ username: 'operador.i36', password: 'OperadorClave9' });
    expect(login.status).toBe(403);
    expect(login.body.code).toBe('FUERA_DE_HORARIO');
    const auditoria = await t.dataSource.query(
      `SELECT id FROM audit_logs WHERE accion = 'LOGIN_FUERA_DE_HORARIO'`,
    );
    expect(auditoria.length).toBeGreaterThan(0);

    // El administrador está exento del control
    const adminOk = await t.http
      .get('/api/v1/warehouses/map')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(adminOk.status).toBe(200);

    // Al desactivar el parámetro el operador vuelve a entrar
    const desactivar = await t.http
      .put(`/api/v1/admin/params/${CLAVE_HORARIO}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        valor: {
          activo: false,
          dias: [1, 2, 3, 4, 5, 6],
          horaInicio: '06:00',
          horaFin: '18:00',
          zonaHoraria: 'America/Bogota',
        },
        motivo: 'Fin de la prueba I36',
      });
    expect(desactivar.status).toBe(200);
    const operadorOk = await t.http
      .get('/api/v1/warehouses/map')
      .set('Authorization', `Bearer ${tokenOperador}`);
    expect(operadorOk.status).toBe(200);
  });

  it('GET /health reporta la base de datos y las migraciones al día', async () => {
    const res = await t.http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.baseDatos).toBe('ok');
    expect(res.body.migraciones).toBe('al_dia');
  });

  it('I38: ajuste puntual de niveles de un estante conserva las ubicaciones', async () => {
    // Bodega con un estante de 4 niveles
    const conf = await t.http
      .post('/api/v1/warehouses/configure')
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({
        nombre: 'Bodega I38',
        forma: 'RECTANGULO',
        anchoM: 40,
        altoM: 30,
        pisos: [
          {
            numero: 1,
            tieneAreasFijas: true,
            pasillos: [
              {
                numero: 1,
                zonas: [
                  { lado: 'IZQUIERDA', estantes: [{ numero: 1, niveles: 4 }] },
                ],
              },
            ],
          },
        ],
      });
    expect(conf.status).toBe(201);

    const mapa = await t.http.get('/api/v1/warehouses/map').set('Authorization', `Bearer ${tokenAdmin}`);
    const rack = mapa.body.pisos[0].pasillos[0].zonas.find((z: any) => z.estantes.length > 0).estantes[0];
    expect(rack.niveles).toBe(4);

    // Producto ubicado en el nivel 3 del estante
    const prod = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({
        empresaId,
        codigo: 'E38-001',
        descripcion: 'Producto niveles I38',
        unidadMedida: 'UND',
        precio: 5000,
      });
    expect(prod.status).toBe(201);
    await t.dataSource.query(`UPDATE products SET cantidad = 10 WHERE id = $1`, [prod.body.id]);
    const ubicar = await t.http
      .post('/api/v1/warehouses/locations')
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ productId: prod.body.id, rackId: rack.id, nivel: 3, cantidad: 5 });
    expect(ubicar.status).toBe(201);

    // Subir niveles: siempre permitido, ubicaciones intactas
    const subir = await t.http
      .patch(`/api/v1/warehouses/racks/${rack.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ niveles: 6 });
    expect(subir.status).toBe(200);
    expect(subir.body.niveles).toBe(6);
    let ubicaciones = await ubicacionesDe(prod.body.id);
    expect(ubicaciones).toHaveLength(1);
    expect(ubicaciones[0].cantidad).toBe(5);

    // Bajar por debajo del nivel ocupado (3): rechazado con mensaje claro
    const bajarDeMas = await t.http
      .patch(`/api/v1/warehouses/racks/${rack.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ niveles: 2 });
    expect(bajarDeMas.status).toBe(400);
    expect(bajarDeMas.body.message).toContain('nivel 3');

    // Bajar justo hasta el nivel ocupado: permitido, ubicación conservada
    const bajarJusto = await t.http
      .patch(`/api/v1/warehouses/racks/${rack.id}`)
      .set('Authorization', `Bearer ${tokenAdmin}`)
      .send({ niveles: 3 });
    expect(bajarJusto.status).toBe(200);
    expect(bajarJusto.body.niveles).toBe(3);
    ubicaciones = await ubicacionesDe(prod.body.id);
    expect(ubicaciones).toHaveLength(1);
    expect(ubicaciones[0].cantidad).toBe(5);

    // RBAC: el generador no ajusta estantes (solo el administrador)
    const porGenerador = await t.http
      .patch(`/api/v1/warehouses/racks/${rack.id}`)
      .set('Authorization', `Bearer ${tokenGenerador}`)
      .send({ niveles: 4 });
    expect(porGenerador.status).toBe(403);

    // Queda auditado
    const logs = await t.dataSource.query(
      `SELECT id FROM audit_logs WHERE accion = 'AJUSTAR_ESTANTE' AND registro_id = $1`,
      [rack.id],
    );
    expect(logs.length).toBeGreaterThan(0);
  });
});
