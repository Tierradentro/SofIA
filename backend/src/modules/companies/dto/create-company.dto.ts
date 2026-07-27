import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * M03 Empresas. `siglas` (3-5 letras) se solicitan en el registro y componen
 * el número visible de pedido SIGLAS-#### (P-09).
 */
export class CreateCompanyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsString()
  @Matches(/^[A-Z]{2,5}$/, {
    message: 'Las siglas deben tener entre 2 y 5 letras (ej. IRE, ICV)',
  })
  siglas: string;

  @IsOptional()
  @IsString()
  @MaxLength(250)
  descripcion?: string;

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
