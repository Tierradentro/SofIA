import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';

export interface ParsedRow {
  [columna: string]: string;
}

export interface ParsedFile {
  columnas: string[];
  filas: ParsedRow[];
}

/**
 * Parseo de archivos Excel (.xlsx/.xls) y CSV de la maestra contable (M18).
 * El sistema detecta automáticamente los campos por la fila de encabezados.
 */
@Injectable()
export class ImportParserService {
  parse(buffer: Buffer, nombreArchivo: string): ParsedFile {
    const ext = nombreArchivo.split('.').pop()?.toLowerCase();
    if (!['xlsx', 'xls', 'csv'].includes(ext || '')) {
      throw new BadRequestException(
        'Formato no soportado: use Excel (.xlsx, .xls) o CSV',
      );
    }
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' });
    } catch {
      throw new BadRequestException('El archivo no se pudo leer');
    }
    const hoja = workbook.Sheets[workbook.SheetNames[0]];
    if (!hoja) throw new BadRequestException('El archivo no contiene hojas');

    const matriz = XLSX.utils.sheet_to_json<string[]>(hoja, {
      header: 1,
      defval: '',
      raw: false,
    }) as unknown as string[][];

    if (matriz.length < 2) {
      throw new BadRequestException(
        'El archivo debe tener una fila de encabezados y al menos una fila de datos',
      );
    }
    const columnas = matriz[0].map((c) => String(c).trim()).filter((c) => c !== '');
    const filas: ParsedRow[] = matriz
      .slice(1)
      .filter((fila) => fila.some((c) => String(c).trim() !== ''))
      .map((fila) => {
        const row: ParsedRow = {};
        columnas.forEach((col, i) => {
          row[col] = String(fila[i] ?? '').trim();
        });
        return row;
      });
    return { columnas, filas };
  }
}
