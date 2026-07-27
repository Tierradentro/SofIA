import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

/** M17: crear API key asociada a un usuario con rol API (M14). */
export class CreateApiKeyDto {
  @IsUUID()
  userId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre: string;
}
