import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { UserStatus } from '../../../common/enums/user-status.enum';

/** HU-005: inactivar (CANCELADO) o bloquear/desbloquear un usuario. */
export class UpdateUserStatusDto {
  @IsEnum(UserStatus)
  estado: UserStatus;

  @IsOptional()
  @IsString()
  motivo?: string;
}
