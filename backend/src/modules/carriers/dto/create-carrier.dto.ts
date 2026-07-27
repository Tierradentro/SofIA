import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { CarrierType } from '../../../common/enums/carrier-type.enum';

export class CreateCarrierDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  /** EXTERNA requiere guía en el despacho; INTERNA no (HU-008/HU-040). */
  @IsEnum(CarrierType)
  tipo: CarrierType;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  identificacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  telefonos?: string;
}
