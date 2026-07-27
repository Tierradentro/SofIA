import { existsSync, readdirSync } from 'fs';
import {
  createTestApp,
  loginAndSetPassword,
  resetTestDatabase,
  TestApp,
  ADMIN,
  ADMIN_NUEVA_CLAVE,
} from './helpers/test-app';

/**
 * M15 + HU-064/065 + A-03: auditoría append-only a nivel de BD (trigger),
 * consulta con filtros, corrección administrativa con motivo obligatorio,
 * y purga con exportación previa auto-auditada.
 */
describe('Auditoría (e2e)', () => {
  let t: TestApp;
  let adminToken: string;
  let operadorToken: string;

  beforeAll(async () => {
    await resetTestDatabase();
    t = await createTestApp();
    adminToken = await loginAndSetPassword(
      t.http,
      ADMIN.username,
      ADMIN.password,
      ADMIN_NUEVA_CLAVE,
    );
    await t.http
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        nombre: 'Operador Tres',
        username: 'operador3',
        email: 'operador3@sofia.local',
        rol: 'OPERADOR',
        claveInicial: 'ClaveInicial1',
      });
    operadorToken = await loginAndSetPassword(
      t.http,
      'operador3',
      'ClaveInicial1',
      'OperadorClave9',
    );
  });

  afterAll(async () => {
    await t.app.close();
    await t.dataSource.destroy().catch(() => undefined);
  });

  it('Append-only a nivel BD: UPDATE y DELETE directos son rechazados por el trigger', async () => {
    await expect(
      t.dataSource.query(`UPDATE audit_logs SET accion='X' WHERE id=1`),
    ).rejects.toThrow(/append-only/);
    await expect(
      t.dataSource.query(`DELETE FROM audit_logs WHERE id=1`),
    ).rejects.toThrow(/append-only/);
  });

  it('HU-065: Administrador consulta logs con filtros por tabla y acción', async () => {
    const res = await t.http
      .get('/api/v1/audit?tabla=users&accion=CREAR')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].tabla).toBe('users');
    expect(res.body.data[0].accion).toBe('CREAR');
  });

  it('RBAC negativo: Operador recibe 403 al consultar auditoría (HU-065)', async () => {
    const res = await t.http
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(res.status).toBe(403);
  });

  it('HU-064: corrección sin motivo no guarda (CU-012)', async () => {
    const companies = await t.http
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${adminToken}`);
    const ire = companies.body.find((c: any) => c.nombre === 'IRE');

    const res = await t.http
      .post('/api/v1/admin/corrections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        tabla: 'companies',
        registroId: ire.id,
        campo: 'ciudad',
        valorNuevo: 'Cota',
      });
    expect(res.status).toBe(400);
  });

  it('HU-064: corrección con motivo registra valor anterior y nuevo en log inalterable', async () => {
    const companies = await t.http
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${adminToken}`);
    const ire = companies.body.find((c: any) => c.nombre === 'IRE');

    const res = await t.http
      .post('/api/v1/admin/corrections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        tabla: 'companies',
        registroId: ire.id,
        campo: 'ciudad',
        valorNuevo: 'Cota',
        motivo: 'Dirección física de la bodega',
      });
    expect(res.status).toBe(201);
    expect(res.body.valorAnterior).toBeNull();
    expect(res.body.valorNuevo).toBe('Cota');

    // Persistió
    const check = await t.http
      .get(`/api/v1/companies/${ire.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(check.body.ciudad).toBe('Cota');

    // Auditado con valor anterior/nuevo
    const logs = await t.dataSource.query(
      `SELECT valor_anterior, valor_nuevo, motivo FROM audit_logs WHERE accion='CORRECCION_ADMIN' AND tabla='companies' AND registro_id=$1`,
      [ire.id],
    );
    expect(logs.length).toBe(1);
    expect(logs[0].valor_nuevo.ciudad).toBe('Cota');
    expect(logs[0].motivo).toBe('Dirección física de la bodega');
  });

  it('HU-064: campos o tablas fuera de la whitelist son rechazados', async () => {
    const res = await t.http
      .post('/api/v1/admin/corrections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        tabla: 'audit_logs',
        registroId: '1',
        campo: 'accion',
        valorNuevo: 'X',
        motivo: 'intento de alterar auditoría',
      });
    expect(res.status).toBe(400);
  });

  it('A-03: purga exige motivo, exporta CSV previo, borra el rango y se auto-audita', async () => {
    // Sin motivo → 400
    let res = await t.http
      .post('/api/v1/audit/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ fechaDesde: '2020-01-01', fechaHasta: '2999-01-01' });
    expect(res.status).toBe(400);

    const antes = await t.dataSource.query(`SELECT count(*)::int AS n FROM audit_logs`);
    expect(antes[0].n).toBeGreaterThan(0);

    res = await t.http
      .post('/api/v1/audit/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fechaDesde: '2020-01-01',
        fechaHasta: '2999-01-01',
        motivo: 'Limpieza programada de almacenamiento',
      });
    expect(res.status).toBe(201);
    expect(res.body.registrosPurgados).toBe(antes[0].n);
    expect(res.body.exportado).toMatch(/\.csv$/);

    // El archivo de exportación existe
    const files = readdirSync('/tmp/sofia-test-exports');
    expect(files.some((f) => f === res.body.exportado)).toBe(true);
    expect(existsSync(`/tmp/sofia-test-exports/${res.body.exportado}`)).toBe(true);

    // Solo queda el registro de auto-auditoría de la purga
    const despues = await t.dataSource.query(
      `SELECT accion, motivo FROM audit_logs`,
    );
    expect(despues.length).toBe(1);
    expect(despues[0].accion).toBe('PURGA_AUDITORIA');
    expect(despues[0].motivo).toBe('Limpieza programada de almacenamiento');
  });

  it('RBAC negativo: Operador recibe 403 al purgar auditoría (A-03)', async () => {
    const res = await t.http
      .post('/api/v1/audit/purge')
      .set('Authorization', `Bearer ${operadorToken}`)
      .send({
        fechaDesde: '2020-01-01',
        fechaHasta: '2999-01-01',
        motivo: 'intento no autorizado',
      });
    expect(res.status).toBe(403);
  });

  it('I14: descarga del respaldo de purga generado (decisión #4)', async () => {
    // Generar una purga para tener un respaldo
    const purga = await t.http
      .post('/api/v1/audit/purge')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fechaDesde: '2020-01-01',
        fechaHasta: '2999-01-01',
        motivo: 'Respaldo para descarga',
      });
    expect(purga.status).toBe(201);
    const archivo = purga.body.exportado;

    // Listar respaldos disponibles
    const lista = await t.http
      .get('/api/v1/audit/purge')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(lista.status).toBe(200);
    expect(lista.body.some((r: any) => r.archivo === archivo)).toBe(true);

    // Descargar el respaldo como CSV
    const descarga = await t.http
      .get(`/api/v1/audit/purge/${archivo}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((r, cb) => {
        let data = '';
        r.on('data', (c: Buffer) => (data += c.toString('utf8')));
        r.on('end', () => cb(null, data));
      });
    expect(descarga.status).toBe(200);
    expect(descarga.headers['content-type']).toContain('text/csv');
    expect(descarga.body).toContain('usuario_username');
    expect(descarga.body).toContain('PURGA_AUDITORIA');

    // Path traversal / nombre inválido → 400
    const malo = await t.http
      .get('/api/v1/audit/purge/..%2F..%2Fetc%2Fpasswd')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(malo.status).toBe(400);
    const inexistente = await t.http
      .get('/api/v1/audit/purge/audit-purge-1.csv')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(inexistente.status).toBe(404);
  });

  it('I14: RBAC negativo — Operador no lista ni descarga respaldos de purga', async () => {
    const lista = await t.http
      .get('/api/v1/audit/purge')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(lista.status).toBe(403);
    const descarga = await t.http
      .get('/api/v1/audit/purge/audit-purge-1.csv')
      .set('Authorization', `Bearer ${operadorToken}`);
    expect(descarga.status).toBe(403);
  });
});
