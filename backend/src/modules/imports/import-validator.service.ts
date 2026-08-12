import { BadRequestException, Injectable } from '@nestjs/common';
import { IMPORT_FIELDS, ImportType } from '../../common/enums/import-type.enum';
import { IMPORT_FIELD_LIMITS } from '../../common/constants/field-limits';
import { ParsedRow } from './import-parser.service';

export interface FilaValidada {
  numeroFila: number;
  datos: Record<string, string>;
  errores: string[];
}

export interface ValidationResult {
  validas: FilaValidada[];
  invalidas: FilaValidada[];
  duplicados: string[];
  columnasMapeadas: Record<string, string>;
}

/**
 * HU-016 / M18: validación de estructura con mapeo declarativo de columnas.
 *  - Verifica columnas faltantes contra los campos requeridos del tipo.
 *  - Valida filas (campos requeridos presentes, cantidad numérica ≥ 0).
 *  - Detecta duplicados dentro del archivo (por clave del tipo).
 */
@Injectable()
export class ImportValidatorService {
  private claveDe(tipo: ImportType): string {
    return tipo === ImportType.PRODUCTOS || tipo === ImportType.CANTIDADES
      ? 'codigo'
      : 'nombre';
  }

  validar(
    tipo: ImportType,
    columnas: string[],
    filas: ParsedRow[],
    mapeo: Record<string, string>,
  ): ValidationResult {
    const campos = IMPORT_FIELDS[tipo];
    const destinosValidos = [...campos.requeridos, ...campos.opcionales];

    // Mapeo declarativo: cada destino debe ser un campo válido del tipo
    for (const [columna, destino] of Object.entries(mapeo)) {
      if (!destinosValidos.includes(destino)) {
        throw new BadRequestException(
          `El campo destino '${destino}' no es válido para importaciones de tipo ${tipo}`,
        );
      }
      if (!columnas.includes(columna)) {
        throw new BadRequestException(
          `La columna '${columna}' no existe en el archivo`,
        );
      }
    }

    // Columnas faltantes: requeridos sin mapear
    const faltantes = campos.requeridos.filter(
      (req) => !Object.values(mapeo).includes(req),
    );
    if (faltantes.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'COLUMNAS_FALTANTES',
        message: `Faltan columnas obligatorias sin mapear: ${faltantes.join(', ')}`,
        columnasFaltantes: faltantes,
        columnasDisponibles: columnas,
      });
    }

    const clave = this.claveDe(tipo);
    const validas: FilaValidada[] = [];
    const invalidas: FilaValidada[] = [];
    const vistos = new Map<string, number>();
    const duplicados: string[] = [];

    filas.forEach((fila, idx) => {
      const datos: Record<string, string> = {};
      for (const [columna, destino] of Object.entries(mapeo)) {
        datos[destino] = (fila[columna] ?? '').trim();
      }
      const errores: string[] = [];

      for (const req of campos.requeridos) {
        if (!datos[req]) errores.push(`Campo obligatorio '${req}' vacío`);
      }
      if (tipo === ImportType.CANTIDADES && datos['cantidad']) {
        const n = Number(datos['cantidad']);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          errores.push(`Cantidad inválida: '${datos['cantidad']}' (debe ser entero ≥ 0)`);
        }
      }
      if (tipo === ImportType.PRODUCTOS && datos['precio']) {
        const n = Number(datos['precio']);
        if (!Number.isFinite(n) || n < 0) {
          errores.push(`Precio inválido: '${datos['precio']}'`);
        }
      }

      // Longitud máxima por campo (QA Func. 1.1): nunca dejar llegar al
      // INSERT un texto que exceda el varchar de la columna → la fila se
      // reporta como inválida en el resumen (mejor esfuerzo), sin 500.
      const limites = IMPORT_FIELD_LIMITS[tipo];
      for (const [campo, maximo] of Object.entries(limites)) {
        const valor = datos[campo];
        if (valor && valor.length > maximo) {
          errores.push(
            `El campo '${campo}' excede el máximo de ${maximo} caracteres (tiene ${valor.length})`,
          );
        }
      }

      const valorClave = datos[clave];
      if (valorClave) {
        if (vistos.has(valorClave)) {
          if (!duplicados.includes(valorClave)) duplicados.push(valorClave);
          errores.push(`Duplicado en el archivo: '${valorClave}'`);
        } else {
          vistos.set(valorClave, idx);
        }
      }

      const resultado: FilaValidada = { numeroFila: idx + 2, datos, errores };
      (errores.length > 0 ? invalidas : validas).push(resultado);
    });

    return { validas, invalidas, duplicados, columnasMapeadas: mapeo };
  }
}
