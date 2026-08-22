import { buildDataSourceOptions } from './data-source';

/**
 * I28: el pool de conexiones debe sobrevivir a un redespliegue — keep-alive
 * para descartar sockets muertos, tiempos de vida acotados para renovar el
 * pool cuando el proxy del PaaS recicla conexiones, y timeout de conexión
 * generoso para arranques simultáneos.
 */
describe('buildDataSourceOptions (I28: resiliencia del pool)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('producción: keep-alive y reciclaje de conexiones activados', () => {
    delete process.env.NODE_ENV;
    const opts = buildDataSourceOptions();
    expect(opts.extra).toMatchObject({
      max: 10,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
      idleTimeoutMillis: 30_000,
      maxLifetimeSeconds: 600,
      connectionTimeoutMillis: 10_000,
    });
  });

  it('pruebas: pool de una sola conexión (PGlite) sin tocar', () => {
    process.env.NODE_ENV = 'test';
    const opts = buildDataSourceOptions();
    expect(opts.extra).toEqual({ max: 1 });
  });

  it('toma la configuración de BD desde variables de entorno', () => {
    process.env.DB_HOST = 'postgres';
    process.env.DB_PORT = '5432';
    process.env.DB_USER = 'sofia_app';
    process.env.DB_NAME = 'sofia';
    const opts = buildDataSourceOptions();
    expect(opts).toMatchObject({
      type: 'postgres',
      host: 'postgres',
      port: 5432,
      username: 'sofia_app',
      database: 'sofia',
      synchronize: false,
    });
  });
});
