import { IsNotEmpty, IsString } from 'class-validator';

/** HU-003: solicita contraseña actual, nueva y confirmación. */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  claveActual: string;

  @IsString()
  @IsNotEmpty()
  claveNueva: string;

  @IsString()
  @IsNotEmpty()
  confirmacion: string;
}
