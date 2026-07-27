import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppDataSource } from './database/data-source';
import { runInitialSeed } from './database/seeds/initial.seed';
import { assertSecretsConfigured } from './common/crypto/secret-crypto';

async function bootstrap() {
  // H-5/C-4: en producción los secretos son obligatorios (sin fallback)
  assertSecretsConfigured();

  // Migraciones + semillas al arrancar (idempotentes), útil en Docker
  if (process.env.RUN_MIGRATIONS !== 'false') {
    if (!AppDataSource.isInitialized) await AppDataSource.initialize();
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
    }),
  );
  app.enableCors({ origin: true, credentials: true });

  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);
  console.log(`SofIA backend escuchando en puerto ${port}`);
}

bootstrap();
