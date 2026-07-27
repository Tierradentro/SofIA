import { IsDefined, IsNotEmpty, IsString } from 'class-validator';

/** Actualización de un parámetro del sistema (M14). */
export class UpdateParamDto {
  @IsDefined({ message: 'El valor del parámetro es obligatorio' })
  valor: Record<string, any>;

  @IsString()
  @IsNotEmpty({ message: 'El motivo es obligatorio para cambiar parámetros' })
  motivo: string;
}
