import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { createTestApp, resetTestDatabase } from './helpers/test-app';

/**
 * I23: /health debe reportar el estado real de la conexión a la base de datos,
 * para diagnosticar de inmediato un redeploy que perdió la conexión.
 */
describe('Health (I23)', () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>;

  beforeAll(async () => {
    await resetTestDatabase();
    const t = await createTestApp();
    app = t.app;
    http = t.http;
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde público, sin autenticación, con la BD operativa', async () => {
    const res = await http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.servicio).toBe('sofia-backend');
    expect(res.body.baseDatos).toBe('ok');
    expect(res.body.status).toBe('ok');
  });

  it('reporta baseDatos=error y estado degradado si la consulta falla', async () => {
    // Simula la pérdida de conexión: se espía el query del DataSource
    const ds = app.get(DataSource);
    const original = ds.query.bind(ds);
    jest.spyOn(ds, 'query').mockRejectedValueOnce(new Error('connection refused'));

    const res = await http.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.baseDatos).toBe('error');
    expect(res.body.status).toBe('degradado');

    jest.restoreAllMocks();
    // La conexión real sigue viva para el resto de la suite
    expect(await original('SELECT 1')).toBeDefined();
  });
});
