import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppDataSource } from './database/data-source';
import { runInitialSeed } from './database/seeds/initial.seed';
import { assertSecretsConfigured } from './common/crypto/secret-crypto';
import { traducirErroresValidacion } from './common/validation/validation-exception.factory';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DataSource } from 'typeorm';

/** I28: espera activa a que la BD acepte conexiones (arranque en PaaS). */
async function conectarConReintentos(ds: DataSource, intentos = 12, esperaMs = 5000) {
  if (ds.isInitialized) return;
  for (let i = 1; i <= intentos; i++) {
    try {
      await ds.initialize();
      return;
    } catch (err) {
      if (i === intentos) throw err;
      console.warn(
        `BD no disponible aún (intento ${i}/${intentos}): ${(err as Error).message}; reintentando en ${esperaMs / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, esperaMs));
    }
  }
}

async function bootstrap() {
  // H-5/C-4: en producción los secretos son obligatorios (sin fallback)
  assertSecretsConfigured();

  // Migraciones + semillas al arrancar (idempotentes), útil en Docker.
  // I28: con reintentos — en un deploy frío el contenedor de Postgres puede
  // tardar más que el backend en quedar listo (aun con healthcheck, la IP
  // puede cambiar tras redespliegues); sin reintento el arranque moría con
  // ECONNREFUSED y el servicio quedaba "sin base de datos".
  if (process.env.RUN_MIGRATIONS !== 'false') {
    await conectarConReintentos(AppDataSource);
    await AppDataSource.runMigrations();
    if (process.env.SEED_ON_BOOT !== 'false') {
      await runInitialSeed(AppDataSource);
    }
  }

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // L-2: campos desconocidos se rechazan, no se descartan en silencio
      forbidNonWhitelisted: true,
      // QA Func. 1.3: mensajes de validación en español (genérico)
      exceptionFactory: traducirErroresValidacion,
    }),
  );
  // QA Func. 1.4: errores de infraestructura → español genérico sin
  // filtrar nombres internos de tabla/columna/constraint al cliente
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: true, credentials: true });

  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);
  console.log(`SofIA backend escuchando en puerto ${port}`);
}

bootstrap();
