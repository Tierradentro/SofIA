import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { PasswordPolicyService } from '../auth/password-policy.service';
import { AuditService } from '../audit/audit.service';
import { UserStatus } from '../../common/enums/user-status.enum';
import { Role } from '../../common/enums/role.enum';

const TABLA = 'users';

function toSafe(user: User) {
  const { passwordHash, ...rest } = user as any;
  return rest;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwordPolicy: PasswordPolicyService,
    private readonly audit: AuditService,
  ) {}

  /** HU-004: crear usuario con rol y contraseña inicial (audita). */
  async create(dto: CreateUserDto, admin: { id: string; username: string }) {
    await this.passwordPolicy.validate(dto.claveInicial);
    const duplicado = await this.users.findOne({
      where: [{ username: dto.username }, { email: dto.email }],
    });
    if (duplicado) {
      throw new ConflictException('El usuario o correo ya existe');
    }
    this.assertComercialAssociation(dto.rol, dto.comercialId);
    const user = await this.users.save(
      this.users.create({
        nombre: dto.nombre,
        descripcion: dto.descripcion || '',
        username: dto.username,
        email: dto.email,
        rol: dto.rol,
        estado: UserStatus.ACTIVO,
        passwordHash: await bcrypt.hash(dto.claveInicial, 10),
        debeCambiarClave: true, // M02: todos cambian la clave en el primer login
        comercialId: dto.rol === Role.COMERCIAL ? dto.comercialId ?? null : null,
      }),
    );
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: user.id,
      valorNuevo: toSafe(user),
    });
    return toSafe(user);
  }

  async findAll() {
    const all = await this.users.find({ order: { fechaCreacion: 'DESC' } });
    return all.map(toSafe);
  }

  async findOne(id: string) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    return toSafe(user);
  }

  /** Editar usuario (M02). Cambio de rol/estado queda auditado. */
  async update(id: string, dto: UpdateUserDto, admin: { id: string; username: string }) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (dto.email && dto.email !== user.email) {
      const dup = await this.users.findOne({ where: { email: dto.email } });
      if (dup) throw new ConflictException('El correo ya existe');
    }
    const anterior = toSafe(user);
    const nuevoRol = dto.rol ?? user.rol;
    const nuevoComercialId =
      dto.comercialId !== undefined ? dto.comercialId : user.comercialId;
    this.assertComercialAssociation(nuevoRol, nuevoComercialId);
    Object.assign(user, {
      nombre: dto.nombre ?? user.nombre,
      descripcion: dto.descripcion ?? user.descripcion,
      email: dto.email ?? user.email,
      rol: nuevoRol,
      comercialId: nuevoRol === Role.COMERCIAL ? nuevoComercialId ?? null : null,
    });
    const saved = await this.users.save(user);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'EDITAR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior,
      valorNuevo: toSafe(saved),
    });
    return toSafe(saved);
  }

  /** HU-005: inactivar/bloquear/reactivar. El usuario inactivo no puede iniciar sesión. */
  async setEstado(id: string, dto: UpdateUserStatusDto, admin: { id: string; username: string }) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.id === admin.id && dto.estado !== UserStatus.ACTIVO) {
      throw new BadRequestException('No puede inactivar su propio usuario');
    }
    const anterior = { estado: user.estado };
    user.estado = dto.estado;
    if (dto.estado === UserStatus.ACTIVO) user.intentosFallidos = 0;
    await this.users.save(user);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CAMBIO_ESTADO',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior,
      valorNuevo: { estado: dto.estado },
      motivo: dto.motivo ?? null,
    });
    return toSafe(user);
  }

  /**
   * Recuperación de contraseña (P-07): el Administrador genera una clave
   * temporal; el usuario debe cambiarla en el próximo login. Sin SMTP en MVP.
   */
  async resetPassword(id: string, admin: { id: string; username: string }) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const temporal = this.generateTemporalPassword();
    user.passwordHash = await bcrypt.hash(temporal, 10);
    user.fechaClave = new Date();
    user.debeCambiarClave = true;
    user.intentosFallidos = 0;
    if (user.estado === UserStatus.BLOQUEADO) user.estado = UserStatus.ACTIVO;
    await this.users.save(user);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'RESET_CLAVE',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { debeCambiarClave: true },
      motivo: 'Recuperación de contraseña por administrador',
    });
    // La clave temporal se muestra una sola vez al administrador
    return { username: user.username, claveTemporal: temporal };
  }

  /** Genera clave temporal que siempre cumple la política (may/min/núm, len≥6). */
  private generateTemporalPassword(): string {
    const rand = randomBytes(4).toString('hex'); // 8 chars [0-9a-f]
    return `Tmp${rand}9`; // mayúscula + minúsculas + números
  }

  async assignComercial(id: string, comercialId: string | null) {
    await this.users.update(id, { comercialId });
  }

  /** M06: la asociación usuario→comercial solo aplica al rol COMERCIAL. */
  private assertComercialAssociation(rol: Role, comercialId?: string | null) {
    if (comercialId && rol !== Role.COMERCIAL) {
      throw new BadRequestException(
        'La asociación a un comercial solo aplica a usuarios con rol Comercial',
      );
    }
  }

  async existsByRole(rol: Role): Promise<boolean> {
    return (await this.users.count({ where: { rol } })) > 0;
  }
}
