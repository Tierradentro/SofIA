import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Purga de logs por Administrador (A-03): requiere rango de fechas y motivo.
 * La exportación previa es obligatoria — el servicio la genera antes de borrar.
 */
export class PurgeAuditDto {
  @IsString()
  @IsNotEmpty()
  fechaDesde: string;

  @IsString()
  @IsNotEmpty()
  fechaHasta: string;

  @IsString()
  @IsNotEmpty({ message: 'El motivo es obligatorio para purgar auditoría' })
  motivo: string;
}
