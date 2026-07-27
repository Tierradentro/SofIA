import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** M17: modificar API key (nombre o estado). */
export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nombre?: string;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
