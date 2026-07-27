import { BadRequestException, Injectable } from '@nestjs/common';
import { ParamsService, PasswordPolicy } from '../params/params.service';

/**
 * Validación de la política de contraseñas (Spec M02, parametrizable):
 * longitud mínima 6, mayúsculas + minúsculas + números, expiración 60 días,
 * bloqueo a los 5 intentos fallidos (la expiración y el bloqueo se aplican
 * en AuthService; aquí se valida la forma de la clave nueva).
 */
@Injectable()
export class PasswordPolicyService {
  constructor(private readonly params: ParamsService) {}

  async validate(clave: string): Promise<void> {
    const policy = await this.params.getPasswordPolicy();
    const errores = this.check(clave, policy);
    if (errores.length > 0) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'PASSWORD_POLICY_VIOLATION',
        message: 'La contraseña no cumple la política de seguridad',
        detalles: errores,
      });
    }
  }

  check(clave: string, policy: PasswordPolicy): string[] {
    const errores: string[] = [];
    if (!clave || clave.length < policy.min_length) {
      errores.push(`Mínimo ${policy.min_length} caracteres`);
    }
    if (policy.require_uppercase && !/[A-Z]/.test(clave)) {
      errores.push('Debe incluir al menos una mayúscula');
    }
    if (policy.require_lowercase && !/[a-z]/.test(clave)) {
      errores.push('Debe incluir al menos una minúscula');
    }
    if (policy.require_number && !/[0-9]/.test(clave)) {
      errores.push('Debe incluir al menos un número');
    }
    return errores;
  }

  isExpired(fechaClave: Date, policy: PasswordPolicy): boolean {
    const limite =
      fechaClave.getTime() + policy.expiration_days * 24 * 60 * 60 * 1000;
    return Date.now() > limite;
  }
}
