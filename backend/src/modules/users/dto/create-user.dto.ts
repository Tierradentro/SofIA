import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Role } from '../../../common/enums/role.enum';

/** HU-004: nombre, correo, usuario, rol, estado y contraseña inicial. */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  nombre: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  descripcion?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  username: string;

  @IsEmail()
  email: string;

  @IsEnum(Role)
  rol: Role;

  /** M06: si el rol es COMERCIAL, se asocia al comercial (scope de consulta). */
  @IsOptional()
  @IsUUID()
  comercialId?: string;

  /** Contraseña inicial: se valida contra la política y debe cambiarse en el primer login. */
  @IsString()
  @IsNotEmpty()
  claveInicial: string;
}
