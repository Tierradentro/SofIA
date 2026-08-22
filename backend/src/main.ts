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

/**
 * I28: conecta a la BD con reintentos. En un deploy de PaaS (EasyPanel) el
 * contenedor de Postgres puede tardar más que el backend en quedar listo, o
 * su IP puede cambiar tras un redespliegue; sin reintento el arranque moría
 * con ECONNREFUSED y el servicio quedaba "sin base de datos" (502 del proxy).
 * El proceso nunca muere: tras agotar los intentos rápidos sigue reintentando
 * de forma indefinida cada 10 s hasta que Postgres esté disponible.
 */
async function conectarConReintentos(ds: DataSource, intentos = 12, esperaMs = 5000): Promise<void> {
  if (ds.isInitialized) return;
  for (let i = 1; ; i++) {
    try {
      await ds.initialize();
      if (i > 1) console.log(`Conexión a la base de datos establecida (intento ${i}).`);
      return;
    } catch (err) {
      const rapido = i <= intentos;
      const espera = rapido ? esperaMs : 10_000;
      console.warn(
        `BD no disponible aún (intento ${i}${rapido ? `/${intentos}` : ''}): ${(err as Error).message}; reintentando en ${espera / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

async function bootstrap() {
  // H-5/C-4: en producción los secretos son obligatorios (sin fallback)
  assertSecretsConfigured();

  // Conexión + migraciones + semillas ANTES de abrir el puerto, pero con
  // reintentos infinitos: el contenedor se mantiene vivo (no crash-loop) y
  // queda listo en cuanto Postgres esté disponible. RUN_MIGRATIONS=false
  // salta la conexión temprana (la abre TypeORM al crear la app).
  if (process.env.RUN_MIGRATIONS !== 'false') {
    await conectarConReintentos(AppDataSource);
    await AppDataSource.runMigrations();
    if (process.env.SEED_ON_BOOT !== 'false') {
      await runInitialSeed(AppDataSource);
    }
    console.log('Migraciones y semillas aplicadas; base de datos lista.');
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
