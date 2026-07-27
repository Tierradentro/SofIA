import { IsNotEmpty, IsString } from 'class-validator';

/**
 * HU-064: corrección administrativa auditada.
 * Exige motivo, y el servicio registra valor anterior y nuevo en log inalterable.
 */
export class CorrectionDto {
  @IsString()
  @IsNotEmpty()
  tabla: string;

  @IsString()
  @IsNotEmpty()
  registroId: string;

  @IsString()
  @IsNotEmpty()
  campo: string;

  @IsNotEmpty({ message: 'El valor nuevo es obligatorio' })
  valorNuevo: any;

  @IsString()
  @IsNotEmpty({ message: 'Sin motivo no se permite guardar la corrección' })
  motivo: string;
}
