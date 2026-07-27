import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { PqrsPriority } from '../entities/pqrs-case.entity';
import { PqrsSupportType } from '../entities/pqrs-support.entity';

/**
 * HU-043 / CU-006 / CU-007: crear caso de devolución.
 * El producto se escanea o selecciona; la asociación a pedido/despacho es
 * opcional (sin coincidencia → factura manual u observación obligatoria).
 */
export class CreatePqrsCaseDto {
  @IsUUID()
  clienteId: string;

  @IsOptional()
  @IsUUID()
  comercialId?: string;

  /** Código escaneado (cualquier identificador del producto). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  codigo: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number;

  /** Factura de venta (manual si no hubo coincidencia, HU-045). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  factura?: string;

  /** CU-007: sin factura ni pedido, la observación es obligatoria. */
  @IsOptional()
  @IsString()
  facturaObservacion?: string;

  /** Motivo del catálogo (G01–G40 / N01–N18, HU-047). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(4)
  motivoCodigo: string;

  @IsOptional()
  @IsString()
  detalle?: string;

  @IsString()
  @IsNotEmpty()
  descripcionCaso: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documento?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsIn([PqrsPriority.ALTA, PqrsPriority.MEDIA, PqrsPriority.BAJA])
  prioridad?: PqrsPriority;

  /** Asociaciones confirmadas por el Operador tras la búsqueda (HU-044). */
  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  dispatchId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  boxId?: string;
}

/** M11: Generador corrige la información y devuelve el caso a ABIERTA. */
export class CorrectPqrsCaseDto {
  @IsOptional()
  @IsUUID()
  comercialId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  factura?: string;

  @IsOptional()
  @IsString()
  facturaObservacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4)
  motivoCodigo?: string;

  @IsOptional()
  @IsString()
  detalle?: string;

  @IsOptional()
  @IsString()
  descripcionCaso?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  documento?: string;

  @IsOptional()
  @IsString()
  notas?: string;

  @IsOptional()
  @IsIn([PqrsPriority.ALTA, PqrsPriority.MEDIA, PqrsPriority.BAJA])
  prioridad?: PqrsPriority;

  /** Motivo de la corrección (auditoría). */
  @IsString()
  @IsNotEmpty()
  motivoCorreccion: string;
}

/** Solicitud de corrección (Operador → Generador valida y corrige). */
export class RequestCorrectionDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;
}

/** M11 Solución: resultado de la validación al cerrar el caso. */
export class ClosePqrsCaseDto {
  @IsString()
  @IsNotEmpty()
  solucionCaso: string;
}

export class CancelPqrsCaseDto {
  @IsOptional()
  @IsString()
  motivo?: string;
}

/** Reingreso manual al inventario por el Generador (M11 Solución). */
export class ReingresoDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  cantidad?: number;

  @IsOptional()
  @IsString()
  notas?: string;
}

/** HU-046: metadatos del soporte (el archivo va multipart). */
export class SupportMetaDto {
  @IsOptional()
  @IsString()
  observacion?: string;

  @IsOptional()
  @IsIn([PqrsSupportType.RECEPCION, PqrsSupportType.SOLUCION])
  tipo?: PqrsSupportType;
}
