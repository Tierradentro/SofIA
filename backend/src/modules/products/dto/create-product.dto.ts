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
import { PRODUCT_FIELD_LIMITS } from '../../../common/constants/field-limits';

/**
 * HU-009: crear producto (Generador). Empresa seleccionada obligatoria
 * (precondición de la HU). Campos según M05.
 * cantidad/cantidad_bloqueada NO se aceptan aquí: nacen en 0 y solo
 * cambian por movimientos (D-01).
 *
 * Los @MaxLength referencian PRODUCT_FIELD_LIMITS (fuente única compartida
 * con el validador de importaciones, QA Func. 1.1).
 */
export class CreateProductDto {
  @IsUUID()
  empresaId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_FIELD_LIMITS.codigo)
  codigo: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(PRODUCT_FIELD_LIMITS.descripcion)
  descripcion: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.proveedor)
  proveedor?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.marca)
  marca?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.vehiculo)
  vehiculo?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.categoria)
  categoria?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.subcategoria)
  subcategoria?: string;

  @IsOptional() @IsString()
  observaciones?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.aplicacion)
  aplicacion?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.codigo_oe)
  codigoOE?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.ref_cruzada_1)
  refCruzada1?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.ref_cruzada_2)
  refCruzada2?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.unidad_medida)
  unidadMedida?: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  precio?: number;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.link_imagen)
  linkImagen?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.ubicacion)
  ubicacion?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.grupo_siete)
  grupoSiete?: string;

  @IsOptional() @IsString() @MaxLength(PRODUCT_FIELD_LIMITS.grupo_ocho)
  grupoOcho?: string;
}
