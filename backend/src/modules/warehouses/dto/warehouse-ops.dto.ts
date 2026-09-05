import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Asociación manual de un producto a una ubicación (estante/nivel, bahía o tránsito). */
export class AssignLocationDto {
  @IsUUID()
  productId: string;

  /** Ubicación normal: estante + nivel. */
  @IsOptional()
  @IsUUID()
  rackId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  nivel?: number;

  /** Bahía temporal/empaque con productos. */
  @IsOptional()
  @IsUUID()
  areaId?: string;

  /** Zona de tránsito (sin ubicación definida). */
  @IsOptional()
  @IsBoolean()
  transito?: boolean;

  @IsInt()
  @Min(0)
  cantidad: number;

  @IsOptional()
  @IsBoolean()
  esOficial?: boolean;
}

export class MoveCajonDto {
  @IsNumber()
  @Min(0)
  posX: number;

  @IsNumber()
  @Min(0)
  posY: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  anchoM?: number;

  // I35: altoM admite 0 porque las entradas se dibujan como línea (sin alto).
  @IsOptional()
  @IsNumber()
  @Min(0)
  altoM?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;
}

/**
 * I38: ajuste puntual de un estante ya configurado (niveles y/o alias),
 * SIN reconfigurar la bodega — las ubicaciones de los productos se conservan.
 * Por eso no se permite bajar los niveles por debajo del nivel más alto
 * ocupado (lo valida el servicio): eso dejaría ubicaciones huérfanas.
 */
export class UpdateRackDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  niveles?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;
}

export class UpdateAliasDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  alias?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  color?: string;
}
