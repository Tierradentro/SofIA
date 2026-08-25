import 'reflect-metadata';
import * as http from 'http';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { conexionEnSegundoPlano, prepararBaseDeDatos, registrarConexion } from './database/data-source';
import { assertSecretsConfigured } from './common/crypto/secret-crypto';
import { traducirErroresValidacion } from './common/validation/validation-exception.factory';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * I30/I31: la conexión a la BD (con migraciones y semillas, siempre) corre
 * EN SEGUNDO PLANO. El puerto se abre primero, de modo que el proxy del PaaS
 * nunca devuelve 502 "Service is not reachable" por un backend que aún
 * espera la BD: /api/v1/health responde siempre y reporta baseDatos
 * ok/degradado. Es idempotente: si el arranque se reintenta, no duplica el
 * registro.
 */
function iniciarConexionEnSegundoPlano(): void {
  if (conexionEnSegundoPlano()) return;
  const promesa = prepararBaseDeDatos();
  promesa.catch((err) =>
    console.error('La conexión en segundo plano terminó con error:', err),
  );
  registrarConexion(promesa);
}

/** Construye y levanta la aplicación Nest completa en el puerto dado. */
async function bootstrap(port: number): Promise<void> {
  // H-5/C-4: en producción los secretos son obligatorios (sin fallback)
  assertSecretsConfigured();

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

  await app.listen(port);
  console.log(`SofIA backend escuchando en puerto ${port}`);
}

/**
 * I30b: servidor mínimo de respaldo. Si el arranque completo falla (p. ej.
 * secretos ausentes en el entorno del PaaS), el contenedor NO debe morir:
 * con el proceso vivo y el puerto abierto, Traefik deja de responder 502
 * "Service is not reachable", /api/v1/health informa el estado degradado y
 * el arranque completo se reintenta periódicamente (ver arrancar()).
 */
function iniciarServidorDegradado(port: number): http.Server {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === '/api/v1/health') {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: 'degradado',
          servicio: 'sofia-backend',
          version: '0.1.0',
          baseDatos: 'error',
          detalle: 'arranque en reintento; revise los logs del servicio',
        }),
      );
      return;
    }
    res.writeHead(503);
    res.end(
      JSON.stringify({
        statusCode: 503,
        message: 'El servicio está iniciando; reintente en unos segundos.',
        error: 'Servicio no disponible',
      }),
    );
  });
  server.on('error', (err) =>
    console.error(`El servidor de respaldo no pudo abrir el puerto ${port}:`, err),
  );
  server.listen(port);
  return server;
}

/**
 * Arranque con reintentos: cualquier fallo (secretos ausentes, error
 * inesperado al crear la app Nest) se registra en el log con su causa y se
 * reintenta cada 15 s, con el servidor de respaldo atendiendo mientras
 * tanto. Así ningún fallo de arranque vuelve a dejar el servicio en 502.
 */
async function arrancar(): Promise<void> {
  const port = parseInt(process.env.PORT || '3001', 10);
  console.log(
    `SofIA backend iniciando (puerto ${port}, ` +
      `BD ${process.env.DB_HOST ?? 'localhost'}:${process.env.DB_PORT ?? '5432'}` +
      `/${process.env.DB_NAME ?? 'sofia'}, entorno ${process.env.NODE_ENV ?? 'desarrollo'})…`,
  );
  iniciarConexionEnSegundoPlano();

  let respaldo: http.Server | null = null;
  for (let intento = 1; ; intento++) {
    try {
      await bootstrap(port);
      return;
    } catch (err) {
      console.error(
        `No se pudo completar el arranque (intento ${intento}); reintento en 15 s. Causa:`,
        err,
      );
      if (!respaldo) respaldo = iniciarServidorDegradado(port);
      await espera(15_000);
      // Liberar el puerto antes del siguiente intento de arranque completo.
      if (respaldo) {
        const s = respaldo;
        respaldo = null;
        await new Promise<void>((resolve) => s.close(() => resolve()));
      }
    }
  }
}

arrancar();
