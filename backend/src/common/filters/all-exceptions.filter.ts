import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { QueryFailedError } from 'typeorm';

/**
 * QA Func. 1.4: filtro global de excepciones.
 *  - Las HttpException ya bien formadas (BadRequest/NotFound/Conflict…,
 *    en español) pasan sin tocar.
 *  - Cualquier error no controlado (TypeORM/Postgres u otro) responde con un
 *    mensaje genérico en español, SIN exponer nombres de tabla, columna o
 *    constraint. El detalle técnico completo solo queda en el log del
 *    servidor.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Excepciones');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      res
        .status(status)
        .json(
          typeof body === 'string'
            ? { statusCode: status, message: body }
            : body,
        );
      return;
    }

    // Infraestructura: loguear el detalle completo SOLO en el servidor
    this.logger.error(
      'Error no controlado',
      exception instanceof Error ? exception.stack : String(exception),
    );

    res.status(500).json({
      statusCode: 500,
      message: mensajeInfraestructura(exception),
      error: 'Error interno',
    });
  }
}

/** Mensaje amigable según el código de error de Postgres, sin detalle interno. */
function mensajeInfraestructura(exception: unknown): string {
  const generico =
    'Ocurrió un error inesperado. Intente de nuevo o contacte al administrador.';
  const code =
    (exception as { driverError?: { code?: string }; code?: string })?.driverError
      ?.code ?? (exception as { code?: string })?.code;
  const message = String((exception as { message?: string })?.message ?? '');

  if (exception instanceof QueryFailedError || code) {
    switch (code) {
      case '23505':
        return 'Ya existe un registro con ese valor; verifique los datos que deben ser únicos (código, siglas, identificación).';
      case '23503':
        return 'No se puede completar la operación: el registro está relacionado con otros datos.';
      case '23502':
        return 'Falta un dato obligatorio para completar la operación.';
      case '23514':
        return 'Uno de los valores no cumple las reglas de consistencia de los datos.';
      default:
        if (code === '22001' || message.includes('value too long')) {
          return 'Uno de los campos ingresados es demasiado largo.';
        }
        return 'No se pudo completar la operación con los datos enviados.';
    }
  }
  return generico;
}
