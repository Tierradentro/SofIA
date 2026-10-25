import { Type } from 'class-transformer';
import {
  IsDefined,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

/**
 * I57: huella del navegador que el frontend genera y conserva en
 * localStorage. Obligatoria en el login: el token queda ligado al
 * dispositivo y el guard global valida que siga autorizado.
 */
export class DispositivoLoginDto {
  @IsString()
  @IsNotEmpty()
  @Length(8, 64)
  deviceId: string;

  @IsString()
  @IsOptional()
  @Length(0, 160)
  nombre?: string;

  @IsString()
  @IsOptional()
  userAgent?: string;

  @IsString()
  @IsOptional()
  @Length(0, 40)
  idioma?: string;

  @IsString()
  @IsOptional()
  @Length(0, 80)
  plataforma?: string;

  @IsString()
  @IsOptional()
  @Length(0, 20)
  resolucion?: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  username: string;

  @IsString()
  @IsNotEmpty()
  password: string;

  /** I57: obligatorio — solo navegadores identificados y autorizados. */
  @IsDefined()
  @ValidateNested()
  @Type(() => DispositivoLoginDto)
  dispositivo: DispositivoLoginDto;
}
