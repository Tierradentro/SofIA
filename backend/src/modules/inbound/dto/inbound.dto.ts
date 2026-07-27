import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class InboundItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  referencia: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  descripcion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unidad?: string;

  @IsInt()
  @Min(0)
  cantidadFacturada: number;
}

/**
 * HU-022: creación de la actividad de ingreso.
 * - Con factura: ocrDocumentId de un documento OCR (FACTURA_IMPORTACION).
 * - Manual: encabezado + items directos (salta al paso 3 del M07).
 */
export class CreateInboundDto {
  @IsUUID()
  empresaId: string;

  @IsOptional()
  @IsUUID()
  ocrDocumentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  numeroFactura?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  fechaFactura?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  proveedor?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InboundItemDto)
  items?: InboundItemDto[];
}

/** Corrección del Generador (documento no legible / Pendiente_Corrección). */
export class UpdateInboundDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  numeroFactura?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  fechaFactura?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  proveedor?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InboundItemDto)
  items?: InboundItemDto[];
}

export class CajaPrincipalDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  codigoCaja: string;
}

export class CantidadRecibidaDto {
  @IsInt()
  @Min(0)
  cantidadRecibida: number;
}

export class ApproveInboundDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  observacion?: string;
}

export class CancelInboundDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
