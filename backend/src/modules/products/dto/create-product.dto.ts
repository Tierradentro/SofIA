import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * HU-009: crear producto (Generador). Empresa seleccionada obligatoria
 * (precondición de la HU). Campos según M05.
 * cantidad/cantidad_bloqueada NO se aceptan aquí: nacen en 0 y solo
 * cambian por movimientos (D-01).
 */
export class CreateProductDto {
  @IsUUID()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  codigo: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(250)
  descripcion: string;

  @IsOptional() @IsString() @MaxLength(150)
  proveedor?: string;

  @IsOptional() @IsString() @MaxLength(120)
  marca?: string;

  @IsOptional() @IsString() @MaxLength(120)
  vehiculo?: string;

  @IsOptional() @IsString() @MaxLength(120)
  categoria?: string;

  @IsOptional() @IsString() @MaxLength(120)
  subcategoria?: string;

  @IsOptional() @IsString()
  observaciones?: string;

  @IsOptional() @IsString() @MaxLength(250)
  aplicacion?: string;

  @IsOptional() @IsString() @MaxLength(60)
  codigoOE?: string;

  @IsOptional() @IsString() @MaxLength(60)
  refCruzada1?: string;

  @IsOptional() @IsString() @MaxLength(60)
  refCruzada2?: string;

  @IsOptional() @IsString() @MaxLength(30)
  unidadMedida?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  precio?: number;

  @IsOptional() @IsString() @MaxLength(500)
  linkImagen?: string;

  @IsOptional() @IsString() @MaxLength(120)
  ubicacion?: string;

  @IsOptional() @IsString() @MaxLength(60)
  grupoSiete?: string;

  @IsOptional() @IsString() @MaxLength(60)
  grupoOcho?: string;
}
