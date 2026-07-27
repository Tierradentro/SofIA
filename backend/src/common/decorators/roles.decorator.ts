import { SetMetadata } from '@nestjs/common';
import { Role } from '../enums/role.enum';

export const ROLES_KEY = 'roles';

/**
 * Declara los roles permitidos para un endpoint. El RolesGuard (global)
 * enforcea en backend; el frontend nunca es la barrera de seguridad.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
