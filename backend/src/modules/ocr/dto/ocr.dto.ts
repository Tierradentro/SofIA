import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { OcrProviderKind } from '../entities/ocr-provider.entity';
import { OcrEngine } from '../entities/ocr-document.entity';
import { DocumentType } from '../../../common/enums/document-type.enum';

export class CreateOcrProviderDto {
  @IsEnum(OcrProviderKind)
  proveedor: OcrProviderKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  modelo: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  apiKey: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  prioridad?: number;
}

export class UpdateOcrProviderDto {
  @IsOptional()
  @IsEnum(OcrProviderKind)
  proveedor?: OcrProviderKind;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  modelo?: string;

  /** Vacío = conservar la actual. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  apiKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  prioridad?: number;
}

export class SetEngineDto {
  @IsEnum(OcrEngine)
  engine: OcrEngine;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo?: string;
}

/** Campos multipart de POST /ocr/documents (llegan como texto). */
export class ProcessOcrDto {
  @IsEnum(DocumentType)
  tipoDocumento: DocumentType;

  @IsOptional()
  @IsUUID()
  empresaId?: string;
}
