import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { TransportType } from '../entities/dispatch.entity';

/** HU-033: crear despacho a partir del primer pedido APROBADO del cliente. */
export class CreateDispatchDto {
  @IsUUID()
  orderId: string;
}

/** HU-034: asociar más pedidos APROBADOS del mismo cliente. */
export class AssociateOrdersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  orderIds: string[];
}

/** HU-036: escaneo de producto a la caja (solo acumula conteo). */
export class ScanBoxDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  codigo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number;
}

/** Operador devuelve el despacho al Generador (PENDIENTE_CORRECCION). */
export class ReturnDispatchDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;
}

/** HU-041: el Generador aprueba el despacho parcial con motivo obligatorio. */
export class ApproveParcialDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;
}

/**
 * HU-039/040: registro de salida. EXTERNA exige transportadora y guía;
 * INTERNA exige el nombre del transporte interno (guía interna opcional).
 */
export class TransportDto {
  @IsIn([TransportType.EXTERNA, TransportType.INTERNA])
  tipo: TransportType;

  @IsOptional()
  @IsUUID()
  carrierId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  guia?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  nombreTransporte?: string;
}

/** Cancelación del despacho (revierte movimientos de cajas cerradas). */
export class CancelDispatchDto {
  @IsOptional()
  @IsString()
  motivo?: string;
}
