import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * I3 — D-01 Libro mayor de movimientos: mecanismo transaccional base
 * (los flujos que lo invocan llegan en I6–I10). Verifica:
 *  - apply() actualiza saldo e inserta movimiento en una transacción.
 *  - Invariantes bajo concurrencia (UPDATE condicional).
 *  - Reconciliación suma(movimientos) = saldo.
 *  - Rollback total ante fallo a mitad de transacción.
 */
describe('Movimientos de inventario (e2e)', () => {
  let t: TestApp;
  let generadorToken: string;
  let productoId: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    const adminToken = await loginAndSetPassword(
      t.http, ADMIN.username, ADMIN.password, ADMIN_NUEVA_CLAVE,
    );
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Generador Mov',
        username: 'generador.mov',
        email: 'generador.mov@sofia.local',
        rol: 'GENERADOR',
        claveInicial: 'ClaveInicial1',
      });
    generadorToken = await loginAndSetPassword(
      t.http, 'generador.mov', 'ClaveInicial1', 'ClaveNueva123',
    );
    const empresa = await t.dataSource.query(
      `SELECT id FROM companies WHERE nombre='IRE'`,
    );
    const p = await t.http
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${generadorToken}`)
      .send({
        empresaId: empresa[0].id,
        codigo: 'MOV-001',
        descripcion: 'Producto de movimientos',
      });
    productoId = p.body.id;
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('apply(): suma existencias con movimiento y saldos resultantes consistentes', async () => {
    const { MovementsService } = await import('../src/modules/movements/movements.service');
    const service = t.app.get(MovementsService);

    await service.apply({
      productId: productoId,
      tipo: 'INGRESO_APROBADO' as any,
      cantidadDelta: 10,
      docTipo: 'INGRESO',
      docId: 'ING-TEST-1',
    });

    const [p] = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE id=$1`,
      [productoId],
    );
    expect(p.cantidad).toBe(10);

    const [m] = await t.dataSource.query(
      `SELECT tipo, cantidad_delta, cantidad_resultante, doc_tipo, doc_id FROM inventory_movements WHERE product_id=$1`,
      [productoId],
    );
    expect(m.tipo).toBe('INGRESO_APROBADO');
    expect(m.cantidad_delta).toBe(10);
    expect(m.cantidad_resultante).toBe(10);
    expect(m.doc_tipo).toBe('INGRESO');
  });

  it('Invariante: no permite saldo negativo ni bloqueada > cantidad (rechazo atómico)', async () => {
    const { MovementsService } = await import('../src/modules/movements/movements.service');
    const service = t.app.get(MovementsService);

    await expect(
      service.apply({
        productId: productoId,
        tipo: 'DESPACHO_CIERRE_CAJA' as any,
        cantidadDelta: -99,
        cantidadBloqueadaDelta: 0,
      }),
    ).rejects.toThrow(/Movimiento inválido/);

    await expect(
      service.apply({
        productId: productoId,
        tipo: 'BLOQUEO_ALISTAMIENTO' as any,
        cantidadBloqueadaDelta: 11, // hay 10
      }),
    ).rejects.toThrow(/Movimiento inválido/);

    // Nada cambió
    const [p] = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE id=$1`,
      [productoId],
    );
    expect(p.cantidad).toBe(10);
    expect(p.cantidad_bloqueada).toBe(0);
  });

  it('Concurrencia: 15 bloqueos simultáneos de 1 unidad sobre 10 → exactamente 10 tienen éxito', async () => {
    const { MovementsService } = await import('../src/modules/movements/movements.service');
    const service = t.app.get(MovementsService);

    const resultados = await Promise.allSettled(
      Array.from({ length: 15 }, () =>
        service.apply({
          productId: productoId,
          tipo: 'BLOQUEO_ALISTAMIENTO' as any,
          cantidadBloqueadaDelta: 1,
        }),
      ),
    );
    const exitosos = resultados.filter((r) => r.status === 'fulfilled').length;
    expect(exitosos).toBe(10);

    const [p] = await t.dataSource.query(
      `SELECT cantidad, cantidad_bloqueada FROM products WHERE id=$1`,
      [productoId],
    );
    expect(p.cantidad_bloqueada).toBe(10);
  });

  it('Reconciliación: suma de movimientos = saldo actual', async () => {
    const res = await t.http
      .get(`/api/v1/movements/producto/${productoId}/reconcile`)
      .set('Authorization', `Bearer ${generadorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.consistente).toBe(true);
    expect(res.body.cantidadMovimientos).toBe(10);
    expect(res.body.bloqueadaMovimientos).toBe(10);
  });

  it('Rollback total: si la transacción del llamador falla, saldo y movimientos quedan intactos', async () => {
    const [antes] = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE id=$1`,
      [productoId],
    );
    const [countAntes] = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE product_id=$1`,
      [productoId],
    );

    await expect(
      t.dataSource.transaction(async (em) => {
        await em.query(
          `UPDATE products SET cantidad = cantidad + 5 WHERE id=$1`,
          [productoId],
        );
        await em.query(
          `INSERT INTO inventory_movements (empresa_id, product_id, tipo, cantidad_delta, cantidad_bloqueada_delta, cantidad_resultante, bloqueada_resultante)
           SELECT empresa_id, id, 'INGRESO_APROBADO', 5, 0, cantidad, cantidad_bloqueada FROM products WHERE id=$1`,
          [productoId],
        );
        throw new Error('fallo simulado a mitad de transacción');
      }),
    ).rejects.toThrow('fallo simulado');

    const [despues] = await t.dataSource.query(
      `SELECT cantidad FROM products WHERE id=$1`,
      [productoId],
    );
    const [countDespues] = await t.dataSource.query(
      `SELECT count(*)::int AS n FROM inventory_movements WHERE product_id=$1`,
      [productoId],
    );
    expect(despues.cantidad).toBe(antes.cantidad);
    expect(countDespues.n).toBe(countAntes.n);
  });

  it('RBAC negativo: rol COMERCIAL no puede consultar movimientos', async () => {
    const adminToken = await loginAndSetPassword(
      t.http, 'Admin', 'AdminSofia2026',
    );
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Comercial Mov',
        username: 'comercial.mov',
        email: 'comercial.mov@sofia.local',
        rol: 'COMERCIAL',
        claveInicial: 'ClaveInicial1',
      });
    const comercialToken = await loginAndSetPassword(
      t.http, 'comercial.mov', 'ClaveInicial1', 'ClaveNueva123',
    );
    const res = await t.http
      .get(`/api/v1/movements/producto/${productoId}`)
      .set('Authorization', `Bearer ${comercialToken}`);
    expect(res.status).toBe(403);
  });
});
