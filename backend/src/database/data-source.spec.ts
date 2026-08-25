import { buildDataSourceOptions, esErrorConfiguracionBd } from './data-source';

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

/**
 * I31: el reintento de conexión distingue "Postgres aún no arranca"
 * (transitorio, se reintenta rápido) de "credenciales/BD mal configuradas"
 * (configuración: se reporta con ERROR destacado en el log y se reintenta
 * con pausa larga, para que no pase desapercibido).
 */
describe('esErrorConfiguracionBd (I31)', () => {
  it('reconoce credenciales inválidas (28P01) y mensajes de autenticación', () => {
    const e28 = new Error('password authentication failed for user "sofia_app"');
    (e28 as any).code = '28P01';
    expect(esErrorConfiguracionBd(e28)).toBe(true);
    expect(esErrorConfiguracionBd(new Error('password authentication failed for user "x"'))).toBe(true);
  });

  it('reconoce base de datos inexistente (3D000) y privilegios insuficientes (42501)', () => {
    const e3d = new Error('database "sofia" does not exist');
    (e3d as any).code = '3D000';
    expect(esErrorConfiguracionBd(e3d)).toBe(true);
    expect(esErrorConfiguracionBd(new Error('database "sofia" does not exist'))).toBe(true);
    const e42 = new Error('permission denied');
    (e42 as any).code = '42501';
    expect(esErrorConfiguracionBd(e42)).toBe(true);
  });

  it('NO marca como configuración los errores transitorios de red', () => {
    const refused = new Error('connect ECONNREFUSED 10.0.0.2:5432');
    (refused as any).code = 'ECONNREFUSED';
    expect(esErrorConfiguracionBd(refused)).toBe(false);
    expect(esErrorConfiguracionBd(new Error('Connection terminated unexpectedly'))).toBe(false);
    const timeout = new Error('timeout exceeded when trying to connect');
    (timeout as any).code = 'ETIMEDOUT';
    expect(esErrorConfiguracionBd(timeout)).toBe(false);
  });
});
