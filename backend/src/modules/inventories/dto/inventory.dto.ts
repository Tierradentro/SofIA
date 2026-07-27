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
import { Type } from 'class-transformer';

/** HU-048: crear jornada de inventario por empresa (snapshot automático). */
export class CreateStockCountDto {
  @IsUUID()
  empresaId: string;

  /** Instrucción de los productos a inventariar (M12). */
  @IsString()
  @IsNotEmpty()
  instruccion: string;

  /** Productos incluidos en la jornada (deben ser de la empresa). */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  productIds: string[];
}

/** HU-049: registro de conteo físico con ubicación en bodega. */
export class CountItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  codigo: string;

  @IsInt()
  @Min(0)
  conteo: number;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  ubicacion?: string;
}

/** HU-051: documentación de una diferencia antes de aprobar. */
export class NotaDiferenciaDto {
  @IsUUID()
  itemId: string;

  @IsString()
  @IsNotEmpty()
  nota: string;
}

export class DocumentarDiferenciasDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => NotaDiferenciaDto)
  notas: NotaDiferenciaDto[];
}

/** HU-052: cancelación con motivo obligatorio (existencias sin cambio). */
export class CancelStockCountDto {
  @IsString()
  @IsNotEmpty()
  motivo: string;
}
