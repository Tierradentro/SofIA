import * as XLSX from 'xlsx';
import { ImportParserService } from './import-parser.service';

/** Genera un .xlsx en memoria con la matriz dada (fila 0 = encabezados). */
function xlsxBuffer(matriz: string[][]): Buffer {
  const hoja = XLSX.utils.aoa_to_sheet(matriz);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja, 'Hoja1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('ImportParserService (QA Func. 1.2)', () => {
  const service = new ImportParserService();

  it('detecta TODAS las columnas por encabezado, aunque la primera fila de datos tenga celdas vacías', () => {
    const buffer = xlsxBuffer([
      ['Código', 'Ref Cruzada', 'Descripción'],
      ['A-001', '', 'Filtro'], // ref cruzada vacía en la fila 1
      ['A-002', 'RC-99', 'Pastilla'], // con valor en la fila 2
    ]);
    const parsed = service.parse(buffer, 'productos.xlsx');
    expect(parsed.columnas).toEqual(['Código', 'Ref Cruzada', 'Descripción']);
    expect(parsed.filas[0]['Ref Cruzada']).toBe('');
    expect(parsed.filas[1]['Ref Cruzada']).toBe('RC-99');
  });

  it('encabezado vacío en medio NO desalinea las columnas siguientes', () => {
    const buffer = xlsxBuffer([
      ['Código', '', 'Descripción'], // segunda columna sin encabezado
      ['A-001', 'basura', 'Filtro de aceite'],
    ]);
    const parsed = service.parse(buffer, 'productos.xlsx');
    expect(parsed.columnas).toEqual(['Código', 'Descripción']);
    // 'Descripción' debe leer la tercera celda, no la segunda
    expect(parsed.filas[0]['Descripción']).toBe('Filtro de aceite');
  });

  it('encabezados duplicados se sufijan sin perder columnas', () => {
    const buffer = xlsxBuffer([
      ['Código', 'Ref', 'Ref'],
      ['A-001', 'RC-1', 'RC-2'],
    ]);
    const parsed = service.parse(buffer, 'productos.xlsx');
    expect(parsed.columnas).toEqual(['Código', 'Ref', 'Ref (2)']);
    expect(parsed.filas[0]['Ref']).toBe('RC-1');
    expect(parsed.filas[0]['Ref (2)']).toBe('RC-2');
  });
});
