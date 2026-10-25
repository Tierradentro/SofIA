import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { AppDataSource } from '../../src/database/data-source';
import { runInitialSeed } from '../../src/database/seeds/initial.seed';
import { traducirErroresValidacion } from '../../src/common/validation/validation-exception.factory';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

/**
 * Reinicia la BD de pruebas (drop/create), corre migraciones y semillas.
 * Se invoca una vez por archivo e2e (los archivos corren con --runInBand).
 */
export async function resetTestDatabase(): Promise<void> {
  if (AppDataSource.isInitialized) await AppDataSource.destroy();

  const admin = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5433', 10),
    username: 'postgres',
    password: '',
    database: 'postgres',
  });
  await admin.initialize();
  await admin.query(
    `DROP DATABASE IF EXISTS ${process.env.DB_NAME} WITH (FORCE)`,
  );
  await admin.query(
    `CREATE DATABASE ${process.env.DB_NAME} OWNER ${process.env.DB_USER}`,
  );
  await admin.destroy();

  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await runInitialSeed(AppDataSource);
}

export interface TestApp {
  app: INestApplication;
  http: ReturnType<typeof request>;
  dataSource: DataSource;
}

export async function createTestApp(): Promise<TestApp> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  // Misma configuración global que main.ts (pipe en español + filtro de excepciones)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      exceptionFactory: traducirErroresValidacion,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  return { app, http: request(app.getHttpServer()), dataSource: AppDataSource };
}

/**
 * I57: huella de navegador de prueba. loginAndSetPassword la usa y, si el
 * dispositivo queda PENDIENTE, lo aprueba directo en BD y reintenta (solo
 * en pruebas; en producción la aprobación es manual por el Administrador).
 */
export const DISPOSITIVO_TEST = {
  deviceId: 'e2e-navegador-autorizado',
  nombre: 'Navegador de pruebas e2e',
};

/** I57: deja el navegador de pruebas APROBADO (equivale a la aprobación
 * manual del Administrador) para que los logins emitan token de una vez. */
export async function aprobarDispositivoTest(): Promise<void> {
  await AppDataSource.query(
    `INSERT INTO devices (device_id, nombre, user_agent, estado, aprobado_at)
     VALUES ($1, 'Navegador de pruebas e2e', 'e2e', 'APROBADO', now())
     ON CONFLICT (device_id) DO UPDATE SET estado = 'APROBADO', aprobado_at = now()`,
    [DISPOSITIVO_TEST.deviceId],
  );
}

async function loginConDispositivo(http: ReturnType<typeof request>, username: string, password: string) {
  let res = await http
    .post('/api/v1/auth/login')
    .send({ username, password, dispositivo: DISPOSITIVO_TEST });
  if (res.status === 200 && res.body.dispositivoAutorizado === false) {
    await AppDataSource.query(
      `UPDATE devices SET estado = 'APROBADO', aprobado_at = now() WHERE device_id = $1`,
      [DISPOSITIVO_TEST.deviceId],
    );
    res = await http
      .post('/api/v1/auth/login')
      .send({ username, password, dispositivo: DISPOSITIVO_TEST });
  }
  return res;
}

/** Login de apoyo: cambia la clave inicial si viene marcada y retorna token usable. */
export async function loginAndSetPassword(
  http: ReturnType<typeof request>,
  username: string,
  password: string,
  nuevaClave?: string,
): Promise<string> {
  const res = await loginConDispositivo(http, username, password);
  if (res.status !== 200 || !res.body.access_token) {
    throw new Error(`Login falló para ${username}: ${JSON.stringify(res.body)}`);
  }
  let token = res.body.access_token;
  if (res.body.usuario.debeCambiarClave) {
    const clave = nuevaClave || 'NuevaClave123';
    const change = await http
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Device-Id', DISPOSITIVO_TEST.deviceId)
      .send({ claveActual: password, claveNueva: clave, confirmacion: clave });
    if (change.status !== 200) {
      throw new Error(`Cambio de clave falló: ${JSON.stringify(change.body)}`);
    }
    const relogin = await loginConDispositivo(http, username, clave);
    token = relogin.body.access_token;
  }
  return token;
}

export const ADMIN = { username: 'Admin', password: 'Admin' };
export const ADMIN_NUEVA_CLAVE = 'AdminSofia2026';
