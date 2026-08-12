import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OrderItemDto {
  /** Código del producto (propio, OE o cruzada) o productId directo. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  referencia: string;

  @IsInt()
  @Min(1)
  cantidad: number;

  /** Si no se envía, se toma el precio del producto (M08: editable). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  valorUnidad?: number;
}

/** HU-028: creación de pedido (manual, OCR o vía API). */
export class CreateOrderDto {
  @IsUUID()
  empresaId: string;

  @IsUUID()
  clienteId: string;

  /** Obligatorio para Generador/Operador; automático para Comercial (M08). */
  @IsOptional()
  @IsUUID()
  comercialId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ciudad?: string;

  /** QA Func. 4.1: dirección del cliente a la que va el despacho. */
  @IsOptional()
  @IsUUID()
  direccionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  ordenPedido?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  /** Documento OCR (ORDEN_PEDIDO o COTIZACION) origen del pedido. */
  @IsOptional()
  @IsUUID()
  ocrDocumentId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

/** Corrección del creador en Pendiente_Corrección (respuesta 4.2). */
export class CorrectOrderDto {
  @IsOptional()
  @IsUUID()
  comercialId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ciudad?: string;

  /** QA Func. 4.1: dirección del cliente a la que va el despacho. */
  @IsOptional()
  @IsUUID()
  direccionId?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  /** Lista completa resultante (permite agregar/eliminar productos). */
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];
}

export enum PickMode {
  /** Seleccionar producto → escanear (registra barcode si no tiene). */
  INICIAL = 'INICIAL',
  /** Escanear directamente; el sistema ubica el producto por barcode. */
  COMPLETO = 'COMPLETO',
}

/** HU-030/HU-031: escaneo de alistamiento. */
export class ScanPickDto {
  @IsEnum(PickMode)
  modo: PickMode;

  /** Requerido en modo INICIAL (selección previa del producto). */
  @IsOptional()
  @IsUUID()
  productId?: string;

  /** Código leído o digitado manualmente (HU-031). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  codigo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number;
}

export class InvoiceOrderDto {
  /** Documento OCR de la factura de venta (FACTURA_VENTA). */
  @IsUUID()
  ocrDocumentId: string;
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}
