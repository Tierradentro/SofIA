import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { ImportType } from '../../../common/enums/import-type.enum';

/**
 * En multipart/form-data los campos llegan como texto: el mapeo viaja como
 * JSON string y aquí se materializa a objeto antes de validar.
 */
function parseMapeo(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new BadRequestException(
      'El campo mapeo debe ser un JSON válido: { columnaExcel: campoDestino }',
    );
  }
}

/**
 * Carga de archivo de importación (M18).
 * mapeo: { columnaExcel: campoDestino } — declarativo, sin código por archivo.
 * empresaId: obligatoria para PRODUCTOS y CANTIDADES.
 */
export class CreateImportDto {
  @IsEnum(ImportType)
  tipo: ImportType;

  @IsOptional()
  @IsUUID()
  empresaId?: string;

  @Transform(({ value }) => parseMapeo(value))
  @IsObject()
  @IsNotEmpty()
  mapeo: Record<string, string>;
}
