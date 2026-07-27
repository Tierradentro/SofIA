import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

/** M06: Nombre, Identificación, Dirección, Teléfonos, Ciudad. */
export class CreateComercialDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  identificacion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  telefonos?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  ciudad?: string;
}

export class UpdateComercialDto extends PartialType(CreateComercialDto) {}
