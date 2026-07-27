/**
 * Entorno de pruebas e2e: PostgreSQL real (local) o PGlite como contingencia.
 */
process.env.NODE_ENV = 'test';
process.env.DB_HOST = process.env.TEST_DB_HOST || '127.0.0.1';
process.env.DB_PORT = process.env.TEST_DB_PORT || '5433';
process.env.DB_USER = process.env.TEST_DB_USER || 'sofia_app';
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD || 'sofia_secret';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'sofia_test';
process.env.JWT_SECRET = 'sofia-test-secret';
process.env.JWT_EXPIRES_IN = '1h';
process.env.EXPORTS_DIR = '/tmp/sofia-test-exports';
process.env.RUN_MIGRATIONS = 'false'; // las corre el helper de pruebas
process.env.SEED_ON_BOOT = 'false';
delete process.env.REDIS_URL; // blacklist en memoria durante pruebas
