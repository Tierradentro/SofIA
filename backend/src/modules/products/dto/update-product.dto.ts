import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateProductDto } from './create-product.dto';
import { ProductStatus } from '../../../common/enums/product-status.enum';

/**
 * Edición de producto (M05). No permite cambiar la empresa ni tocar
 * cantidades directamente (solo movimientos — D-01).
 */
export class UpdateProductDto extends PartialType(CreateProductDto) {
  @IsOptional()
  @IsEnum(ProductStatus)
  estado?: ProductStatus;
}
