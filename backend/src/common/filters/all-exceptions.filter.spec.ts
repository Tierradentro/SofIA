import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { AllExceptionsFilter } from './all-exceptions.filter';

/** Simula el host HTTP y captura la respuesta. */
function hostFalso() {
  const res: any = {
    statusCode: 0,
    body: null as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res };
}

function queryFailed(code: string, message: string): QueryFailedError {
  const err = new QueryFailedError('INSERT INTO x', [], new Error(message));
  (err as any).driverError = { code, message };
  (err as any).code = code;
  return err;
}

describe('AllExceptionsFilter (QA Func. 1.4)', () => {
  const filter = new AllExceptionsFilter();

  it('deja pasar HttpException sin tocar (BadRequest con mensaje propio)', () => {
    const { host, res } = hostFalso();
    const ex = new BadRequestException({
      statusCode: 400,
      code: 'COLUMNAS_FALTANTES',
      message: 'Faltan columnas obligatorias sin mapear: descripcion',
    });
    filter.catch(ex, host);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain('Faltan columnas obligatorias');
    expect(res.body.code).toBe('COLUMNAS_FALTANTES');
  });

  it('deja pasar NotFoundException (404) sin tocar', () => {
    const { host, res } = hostFalso();
    filter.catch(new NotFoundException('Producto no encontrado'), host);
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe('Producto no encontrado');
  });

  it('23505 (duplicado) → mensaje en español sin nombres internos', () => {
    const { host, res } = hostFalso();
    filter.catch(
      queryFailed(
        '23505',
        'duplicate key value violates unique constraint "UQ_companies_siglas"',
      ),
      host,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toContain('Ya existe un registro');
    const crudo = JSON.stringify(res.body);
    expect(crudo).not.toContain('UQ_companies_siglas');
    expect(crudo).not.toContain('duplicate key');
  });

  it('23503 (llave foránea) → mensaje de dependencia', () => {
    const { host, res } = hostFalso();
    filter.catch(queryFailed('23503', 'violates foreign key constraint "fk_order_client"'), host);
    expect(res.body.message).toContain('relacionado con otros datos');
    expect(JSON.stringify(res.body)).not.toContain('fk_order_client');
  });

  it('value too long (22001) → mensaje de longitud', () => {
    const { host, res } = hostFalso();
    filter.catch(
      queryFailed('22001', 'value too long for type character varying(250)'),
      host,
    );
    expect(res.body.message).toContain('demasiado largo');
    expect(JSON.stringify(res.body)).not.toContain('character varying');
  });

  it('error genérico (no DB) → 500 genérico sin stack ni detalle', () => {
    const { host, res } = hostFalso();
    filter.catch(new Error('boom interno en nbtinsert.c:123'), host);
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toContain('error inesperado');
    expect(JSON.stringify(res.body)).not.toContain('nbtinsert');
  });
});
