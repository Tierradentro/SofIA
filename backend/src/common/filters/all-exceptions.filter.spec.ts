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

  it('I36: 42P01/42703 (migración sin aplicar) → mensaje claro y reintentable', () => {
    const { host, res } = hostFalso();
    filter.catch(
      queryFailed('42P01', 'relation "warehouse_areas" does not exist'),
      host,
    );
    expect(res.statusCode).toBe(500);
    expect(res.body.message).toContain('se está actualizando');
    expect(JSON.stringify(res.body)).not.toContain('warehouse_areas');

    const { host: host2, res: res2 } = hostFalso();
    filter.catch(
      queryFailed('42703', 'column p.color does not exist'),
      host2,
    );
    expect(res2.body.message).toContain('intente de nuevo');
    expect(JSON.stringify(res2.body)).not.toContain('p.color');
  });

  it('I28: pool sin conexión (ConnectionNotFoundError) → 503 reintentable', () => {
    const { host, res } = hostFalso();
    const ex = new Error('ConnectionNotFoundError: Connection "default" was not found.');
    ex.name = 'ConnectionNotFoundError';
    filter.catch(ex, host);
    expect(res.statusCode).toBe(503);
    expect(res.body.message).toContain('base de datos no está disponible');
  });

  it('I28: corte de BD en caliente (ECONNREFUSED / Connection terminated) → 503', () => {
    const { host, res } = hostFalso();
    const ex = new Error('connect ECONNREFUSED 10.0.0.2:5432') as Error & { code?: string };
    ex.code = 'ECONNREFUSED';
    filter.catch(ex, host);
    expect(res.statusCode).toBe(503);
    const { host: host2, res: res2 } = hostFalso();
    filter.catch(new Error('Connection terminated unexpectedly'), host2);
    expect(res2.statusCode).toBe(503);
  });

  it('I30: consulta con el puerto ya abierto y la BD aún sin inicializar → 503', () => {
    // CannotExecuteNotConnectedError: dataSource.query() antes de initialize()
    const { host, res } = hostFalso();
    const ex1 = new Error('Cannot execute operation on "default" connection because connection is not yet established.');
    ex1.name = 'CannotExecuteNotConnectedError';
    filter.catch(ex1, host);
    expect(res.statusCode).toBe(503);
    expect(res.body.message).toContain('base de datos no está disponible');
    // EntityMetadataNotFoundError: repository.find() antes de initialize()
    const { host: host2, res: res2 } = hostFalso();
    const ex2 = new Error('No metadata for "User" was found.');
    ex2.name = 'EntityMetadataNotFoundError';
    filter.catch(ex2, host2);
    expect(res2.statusCode).toBe(503);
  });
});
