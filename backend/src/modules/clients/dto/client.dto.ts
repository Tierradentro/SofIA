import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';

/** M04: Nombre, Identificación, Dirección, Teléfonos, Ciudad. I41: + Correo electrónico. */
export class CreateClientDto {
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

  /** I41: opcional; vacío se trata como "sin correo". */
  @IsOptional()
  @ValidateIf((o) => o.email !== '' && o.email != null)
  @IsEmail({}, { message: 'El correo electrónico no es válido' })
  @MaxLength(160)
  email?: string;
}

export class UpdateClientDto extends PartialType(CreateClientDto) {}
