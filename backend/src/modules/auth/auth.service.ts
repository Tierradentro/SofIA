import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { User } from '../users/entities/user.entity';
import { UserStatus } from '../../common/enums/user-status.enum';
import { ParamsService } from '../params/params.service';
import { PasswordPolicyService } from './password-policy.service';
import { TokenBlacklistService } from './token-blacklist.service';
import { AuditService } from '../audit/audit.service';
import { ChangePasswordDto } from './dto/change-password.dto';

/** Mensaje genérico: nunca revela si el usuario existe o está bloqueado (HU-001). */
const INVALID_CREDENTIALS = 'Usuario o contraseña incorrectos';

/** Hash bcrypt precalculado ('sofia-timing-dummy') para igualar tiempos (M-9). */
const DUMMY_HASH = '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly params: ParamsService,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly blacklist: TokenBlacklistService,
    private readonly audit: AuditService,
  ) {}

  /** HU-001: login con bloqueo por intentos fallidos y expiración de clave (M02). */
  async login(username: string, password: string) {
    const user = await this.users.findOne({ where: { username } });

    if (!user || user.estado !== UserStatus.ACTIVO) {
      // M-9: comparación contra un hash dummy para igualar el tiempo de
      // respuesta entre "usuario inexistente" y "clave errada" (evita
      // enumeración de usuarios por canal lateral de tiempo)
      await bcrypt.compare(password, DUMMY_HASH);
      await this.audit.log({
        usuarioId: user?.id ?? null,
        usuarioUsername: username,
        accion: 'LOGIN_FALLIDO',
        tabla: 'users',
        registroId: user?.id ?? null,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const policy = await this.params.getPasswordPolicy();
      user.intentosFallidos += 1;
      if (user.intentosFallidos >= policy.max_failed_attempts) {
        user.estado = UserStatus.BLOQUEADO;
        await this.users.save(user);
        await this.audit.log({
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'USUARIO_BLOQUEADO_INTENTOS',
          tabla: 'users',
          registroId: user.id,
          valorAnterior: { estado: UserStatus.ACTIVO },
          valorNuevo: { estado: UserStatus.BLOQUEADO },
          motivo: `${policy.max_failed_attempts} intentos fallidos de inicio de sesión`,
        });
      } else {
        await this.users.save(user);
      }
      await this.audit.log({
        usuarioId: user.id,
        usuarioUsername: user.username,
        accion: 'LOGIN_FALLIDO',
        tabla: 'users',
        registroId: user.id,
      });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    // Clave expirada (60 días por defecto): fuerza cambio en el próximo paso
    const policy = await this.params.getPasswordPolicy();
    if (this.passwordPolicy.isExpired(user.fechaClave, policy)) {
      user.debeCambiarClave = true;
    }
    user.intentosFallidos = 0;
    await this.users.save(user);

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'LOGIN',
      tabla: 'users',
      registroId: user.id,
    });

    return this.issueToken(user);
  }

  private issueToken(user: User) {
    const jti = randomUUID();
    const token = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      rol: user.rol,
      jti,
    });
    return {
      access_token: token,
      usuario: {
        id: user.id,
        nombre: user.nombre,
        username: user.username,
        rol: user.rol,
        debeCambiarClave: user.debeCambiarClave,
      },
    };
  }

  /** HU-003: cambio de contraseña con validación de actual + política. */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.claveNueva !== dto.confirmacion) {
      throw new BadRequestException(
        'La nueva contraseña y la confirmación no coinciden',
      );
    }
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException(INVALID_CREDENTIALS);

    const ok = await bcrypt.compare(dto.claveActual, user.passwordHash);
    if (!ok) {
      throw new BadRequestException('La contraseña actual es incorrecta');
    }
    await this.passwordPolicy.validate(dto.claveNueva);

    const anterior = { fechaClave: user.fechaClave, debeCambiarClave: user.debeCambiarClave };
    user.passwordHash = await bcrypt.hash(dto.claveNueva, 10);
    user.fechaClave = new Date();
    user.debeCambiarClave = false;
    user.intentosFallidos = 0;
    await this.users.save(user);

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'CAMBIO_CLAVE',
      tabla: 'users',
      registroId: user.id,
      valorAnterior: anterior,
      valorNuevo: { fechaClave: user.fechaClave, debeCambiarClave: false },
    });

    return { mensaje: 'Contraseña actualizada' };
  }

  /** HU-002: cierre de sesión — el token queda invalidado en la blacklist. */
  async logout(jti: string, exp: number, user: { id: string; username: string }) {
    await this.blacklist.revoke(jti, exp);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'LOGOUT',
      tabla: 'users',
      registroId: user.id,
    });
    return { mensaje: 'Sesión finalizada' };
  }

  me(user: { id: string; username: string; nombre: string; rol: string }) {
    return user;
  }
}
