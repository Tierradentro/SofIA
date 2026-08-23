import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppDataSource, registrarConexion } from './database/data-source';
import { runInitialSeed } from './database/seeds/initial.seed';
import { assertSecretsConfigured } from './common/crypto/secret-crypto';
import { traducirErroresValidacion } from './common/validation/validation-exception.factory';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DataSource } from 'typeorm';

/**
 * I30: conecta a la BD con reintentos infinitos. En un deploy de PaaS
 * (EasyPanel/Traefik) el contenedor de Postgres puede tardar más que el
 * backend, o su IP puede cambiar tras un redespliegue. El proceso nunca
 * muere por un ECONNREFUSED: reintenta hasta que Postgres esté disponible.
 */
async function conectarConReintentos(ds: DataSource, esperaMs = 5000): Promise<DataSource> {
  for (let i = 1; ; i++) {
    if (ds.isInitialized) return ds;
    try {
      await ds.initialize();
      if (i > 1) console.log(`Conexión a la base de datos establecida (intento ${i}).`);
      return ds;
    } catch (err) {
      const espera = i <= 12 ? esperaMs : 10_000;
      console.warn(
        `BD no disponible aún (intento ${i}): ${(err as Error).message}; reintentando en ${espera / 1000}s…`,
      );
      await new Promise((r) => setTimeout(r, espera));
    }
  }
}

async function bootstrap() {
  // H-5/C-4: en producción los secretos son obligatorios (sin fallback)
  assertSecretsConfigured();

  // I30: la conexión a la BD (con migraciones y semillas) corre EN SEGUNDO
  // PLANO. El puerto se abre primero, de modo que el proxy del PaaS nunca
  // devuelve 502 "Service is not reachable" por un backend que aún espera la
  // BD: /api/v1/health responde siempre y reporta baseDatos ok/degradado.
  let promesa: Promise<DataSource>;
  if (process.env.RUN_MIGRATIONS !== 'false') {
    promesa = conectarConReintentos(AppDataSource).then(async (ds) => {
      await ds.runMigrations();
      if (process.env.SEED_ON_BOOT !== 'false') {
        await runInitialSeed(ds);
      }
      console.log('Migraciones y semillas aplicadas; base de datos lista.');
      return ds;
    });
  } else {
    promesa = conectarConReintentos(AppDataSource);
  }
  registrarConexion(promesa);

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
