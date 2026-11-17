import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { ProductStatus } from '../../../common/enums/product-status.enum';

/**
 * Edición de producto (M05). No permite cambiar la empresa ni tocar
 * cantidades directamente (solo movimientos — D-01).
 * I71: fichaPendiente permite quitar la marca de "ficha técnica pendiente"
 * de los productos creados automáticamente por un ingreso de mercancía.
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsOptional()
  @IsEnum(ProductStatus)
  estado?: ProductStatus;

  @IsOptional()
  @IsBoolean()
  fichaPendiente?: boolean;
}
