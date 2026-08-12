import { BadRequestException } from '@nestjs/common';
import { ImportValidatorService } from './import-validator.service';
import { ImportType } from '../../common/enums/import-type.enum';

describe('ImportValidatorService (HU-016)', () => {
  const service = new ImportValidatorService();

  const columnas = ['Referencia', 'Descripción', 'Cantidad'];
  const filas = [
    { Referencia: 'A-001', Descripción: 'Filtro', Cantidad: '10' },
    { Referencia: 'A-002', Descripción: 'Pastilla', Cantidad: '5' },
  ];

  it('valida con mapeo declarativo correcto', () => {
    const r = service.validar(ImportType.PRODUCTOS, columnas, filas, {
      Referencia: 'codigo',
      Descripción: 'descripcion',
    });
    expect(r.validas.length).toBe(2);
    expect(r.invalidas.length).toBe(0);
    expect(r.validas[0].datos.codigo).toBe('A-001');
  });

  it('HU-016: columnas faltantes → error con detalle de faltantes', () => {
    expect(() =>
      service.validar(ImportType.PRODUCTOS, columnas, filas, {
        Referencia: 'codigo',
        // falta descripcion
      }),
    ).toThrow(BadRequestException);
    try {
      service.validar(ImportType.PRODUCTOS, columnas, filas, { Referencia: 'codigo' });
    } catch (e: any) {
      expect(e.getResponse().code).toBe('COLUMNAS_FALTANTES');
      expect(e.getResponse().columnasFaltantes).toContain('descripcion');
    }
  });

  it('rechaza campo destino inválido y columna inexistente', () => {
    expect(() =>
      service.validar(ImportType.PRODUCTOS, columnas, filas, {
        Referencia: 'campo_inventado',
        Descripción: 'descripcion',
      }),
    ).toThrow(/no es válido/);
    expect(() =>
      service.validar(ImportType.PRODUCTOS, columnas, filas, {
        ColumnaQueNoExiste: 'codigo',
        Descripción: 'descripcion',
      }),
    ).toThrow(/no existe en el archivo/);
  });

  it('HU-016: detecta duplicados dentro del archivo', () => {
    const conDuplicado = [...filas, { Referencia: 'A-001', Descripción: 'Otra', Cantidad: '1' }];
    const r = service.validar(ImportType.PRODUCTOS, columnas, conDuplicado, {
      Referencia: 'codigo',
      Descripción: 'descripcion',
    });
    expect(r.duplicados).toContain('A-001');
    expect(r.invalidas.some((f) => f.errores.some((e) => e.includes('Duplicado')))).toBe(true);
  });

  it('QA Func. 1.1: texto que excede el varchar de la columna → fila inválida, nunca llega al INSERT', () => {
    const larga = 'x'.repeat(300); // descripcion es varchar(250)
    const r = service.validar(
      ImportType.PRODUCTOS,
      columnas,
      [
        { Referencia: 'A-001', Descripción: larga, Cantidad: '10' },
        { Referencia: 'A-002', Descripción: 'Pastilla', Cantidad: '5' },
      ],
      { Referencia: 'codigo', Descripción: 'descripcion' },
    );
    expect(r.validas.length).toBe(1);
    expect(r.invalidas.length).toBe(1);
    const err = r.invalidas[0].errores[0];
    expect(err).toContain('descripcion');
    expect(err).toContain('250');
    expect(err).toContain('300');
  });

  it('QA Func. 1.1: aplica el límite de cada campo (código 60, aplicación 250, nombre cliente 200)', () => {
    const r = service.validar(
      ImportType.PRODUCTOS,
      columnas,
      [{ Referencia: 'C'.repeat(61), Descripción: 'OK', Cantidad: '1' }],
      { Referencia: 'codigo', Descripción: 'descripcion' },
    );
    expect(r.invalidas[0].errores[0]).toContain("'codigo' excede el máximo de 60");

    const rc = service.validar(
      ImportType.CLIENTES,
      ['Nombre'],
      [{ Nombre: 'N'.repeat(201) }],
      { Nombre: 'nombre' },
    );
    expect(rc.invalidas[0].errores[0]).toContain("'nombre' excede el máximo de 200");
  });

  it('CANTIDADES: valida entero ≥ 0 y reporta filas inválidas', () => {
    const r = service.validar(
      ImportType.CANTIDADES,
      columnas,
      [
        { Referencia: 'A-001', Cantidad: '10' },
        { Referencia: 'A-002', Cantidad: '-3' },
        { Referencia: 'A-003', Cantidad: 'abc' },
        { Referencia: '', Cantidad: '5' },
      ],
      { Referencia: 'codigo', Cantidad: 'cantidad' },
    );
    expect(r.validas.length).toBe(1);
    expect(r.invalidas.length).toBe(3);
  });
});
