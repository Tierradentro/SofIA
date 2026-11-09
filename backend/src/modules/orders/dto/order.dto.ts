import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateIf,
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

/**
 * I67: guardado automático del borrador de «Nuevo pedido». El payload es el
 * contenido del formulario tal cual (admite datos parciales: ítems a medio
 * digitar, cliente aún sin elegir); la validación estricta ocurre al
 * confirmar, que es cuando se crea el pedido y se asigna el consecutivo.
 */
export class SaveOrderDraftDto {
  @IsOptional()
  @IsUUID()
  empresaId?: string;

  @IsDefined()
  @IsObject()
  payload: Record<string, unknown>;
}

/** Corrección del creador en Pendiente_Corrección (respuesta 4.2). */
export class CorrectOrderDto {
  /** I68: el cliente solo lo cambian Generador/Administrador (validado en servicio). */
  @IsOptional()
  @IsUUID()
  clienteId?: string;

  /** I68: el vendedor (comercial) solo lo cambian Generador/Administrador. */
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

/** I61: ajuste de precios del pedido (solo Administrador, en cualquier estado). */
export class AdjustPricesItemDto {
  @IsUUID()
  itemId: string;

  @IsNumber()
  @Min(0)
  valorUnidad: number;
}

export class AdjustPricesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustPricesItemDto)
  items: AdjustPricesItemDto[];
}

export class CancelOrderDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  motivo?: string;
}

/**
 * I69: ítem del ajuste post-factura. `cantidadFacturada` es lo que quedó en
 * la factura corregida de World Office (0 = el producto sale del pedido).
 */
export class AjusteFacturaItemDto {
  /** Línea existente del pedido (aumento, disminución o retiro total). */
  @ValidateIf((o) => !o.productId)
  @IsUUID()
  itemId?: string;

  /**
   * Producto nuevo: está en la factura corregida y en el catálogo, pero no
   * en el pedido; el ajuste lo ingresa (itemId y productId son excluyentes).
   */
  @ValidateIf((o) => !o.itemId)
  @IsUUID()
  productId?: string;

  @IsInt()
  @Min(0)
  cantidadFacturada: number;
}

/**
 * I69/I70: ajuste de un pedido Aprobado/Despachado contra la nueva factura
 * (el pedido, el despacho y la factura ya se corrigieron «en directo» y en
 * WO; aquí se refleja en Sofía). El número de la factura corregida debe ser
 * el mismo de la factura del pedido. Ajusta en ambos sentidos: las unidades
 * de más retornan al inventario y las de menos (o los productos nuevos)
 * salen del inventario; si el pedido está Despachado, entradas y salidas
 * afectan la última caja creada del despacho. Solo Generador/Administrador.
 */
export class AjusteFacturaDto {
  /** Documento OCR de la factura de venta corregida (FACTURA_VENTA). */
  @IsUUID()
  ocrDocumentId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AjusteFacturaItemDto)
  ajustes: AjusteFacturaItemDto[];
}
