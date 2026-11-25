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
import { Comercial } from '../comerciales/entities/comercial.entity';
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

/**
 * I75: normaliza un nombre para usarlo como llave de asociación
 * usuario↔comercial: sin tildes, minúsculas y espacios colapsados, de modo
 * que «Juan Pérez», «JUAN PEREZ» y «juan  pérez» sean la misma llave.
 */
export function normalizarNombreClave(valor: string): string {
  return (valor || '')
    .normalize('NFD')
    // rango de diacríticos combinantes U+0300–U+036F
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Resultado de la asociación usuario→comercial (I75). */
export interface AsociacionComercial {
  estado: 'MANUAL' | 'AUTO' | 'SIN_COINCIDENCIA' | 'AMBIGUA' | 'YA_ASIGNADO';
  comercialId: string | null;
  comercialNombre: string | null;
  mensaje: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Comercial) private readonly comerciales: Repository<Comercial>,
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
    // I75: si no se indica comercial explícito, el nombre del usuario es la
    // llave de asociación automática con el catálogo de comerciales.
    let asociacion: AsociacionComercial | undefined;
    let comercialId: string | null = null;
    if (dto.rol === Role.COMERCIAL) {
      asociacion = dto.comercialId
        ? await this.asociacionManual(dto.comercialId)
        : await this.resolverComercialPorNombre(dto.nombre);
      comercialId = asociacion.comercialId;
    }
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
        comercialId,
      }),
    );
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: user.id,
      valorNuevo: toSafe(user),
      ...(asociacion?.estado === 'AUTO'
        ? { motivo: `Asociación automática usuario→comercial por nombre («${asociacion.comercialNombre}»)` }
        : {}),
    });
    return { ...toSafe(user), ...(asociacion ? { asociacionComercial: asociacion } : {}) };
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
    let nuevoComercialId =
      dto.comercialId !== undefined ? dto.comercialId : user.comercialId;
    // Si el rol deja de ser COMERCIAL el comercial se limpia implícitamente;
    // la validación se hace sobre el valor efectivo, no sobre el heredado
    // (antes cambiar de rol a un comercial asociado respondía 400).
    this.assertComercialAssociation(
      nuevoRol,
      nuevoRol === Role.COMERCIAL ? nuevoComercialId : null,
    );
    // I75: comercial explícito validado; si queda sin comercial y el rol es
    // COMERCIAL, se intenta la asociación automática por nombre.
    let asociacion: AsociacionComercial | undefined;
    if (nuevoRol === Role.COMERCIAL) {
      if (dto.comercialId) {
        asociacion = await this.asociacionManual(dto.comercialId);
        nuevoComercialId = asociacion.comercialId;
      } else if (dto.comercialId === undefined && !nuevoComercialId) {
        // Solo cuando el admin no tocó el campo: null explícito = desasociar.
        asociacion = await this.resolverComercialPorNombre(
          dto.nombre ?? user.nombre,
          id,
        );
        nuevoComercialId = asociacion.comercialId;
      }
    }
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
      ...(asociacion?.estado === 'AUTO'
        ? { motivo: `Asociación automática usuario→comercial por nombre («${asociacion.comercialNombre}»)` }
        : {}),
    });
    return { ...toSafe(saved), ...(asociacion ? { asociacionComercial: asociacion } : {}) };
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
    user.bloqueadoHasta = null;
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

  /**
   * I75: asociación manual — el administrador indicó el comercial explícito.
   * Valida que exista (antes un UUID inválido solo fallaba por la FK → 500).
   */
  private async asociacionManual(comercialId: string): Promise<AsociacionComercial> {
    const comercial = await this.comerciales.findOne({ where: { id: comercialId } });
    if (!comercial) {
      throw new BadRequestException(`Comercial no encontrado (${comercialId})`);
    }
    return {
      estado: 'MANUAL',
      comercialId: comercial.id,
      comercialNombre: comercial.nombre,
      mensaje: `Asociado manualmente al comercial «${comercial.nombre}»`,
    };
  }

  /**
   * I75: llave de asociación automática — el nombre del usuario se compara
   * (normalizado) con los nombres del catálogo de comerciales activos.
   * Fail-safe: solo asocia cuando hay exactamente un candidato y ese
   * comercial no tiene ya otro usuario comercial activo (asociación 1:0..1).
   */
  private async resolverComercialPorNombre(
    nombre: string,
    excluirUsuarioId?: string,
  ): Promise<AsociacionComercial> {
    const clave = normalizarNombreClave(nombre);
    const activos = await this.comerciales.find({ where: { activo: true } });
    const candidatos = activos.filter((c) => normalizarNombreClave(c.nombre) === clave);
    const sinAsociar: AsociacionComercial['estado'][] = ['SIN_COINCIDENCIA', 'AMBIGUA', 'YA_ASIGNADO'];
    const base = { comercialId: null, comercialNombre: null };
    if (!clave || candidatos.length === 0) {
      return {
        ...base,
        estado: sinAsociar[0],
        mensaje:
          `Sin comercial asociado: ningún comercial activo se llama «${nombre}». ` +
          'El usuario no verá pedidos ni despachos hasta que un administrador lo asocie.',
      };
    }
    if (candidatos.length > 1) {
      return {
        ...base,
        estado: sinAsociar[1],
        mensaje:
          `Sin comercial asociado: hay ${candidatos.length} comerciales activos con el nombre «${candidatos[0].nombre}». ` +
          'Asócielo manualmente desde esta pantalla.',
      };
    }
    const comercial = candidatos[0];
    const ocupante = await this.users.findOne({
      where: { comercialId: comercial.id, rol: Role.COMERCIAL, estado: UserStatus.ACTIVO },
    });
    if (ocupante && ocupante.id !== excluirUsuarioId) {
      return {
        ...base,
        estado: sinAsociar[2],
        mensaje:
          `Sin comercial asociado: «${comercial.nombre}» ya está asignado al usuario «${ocupante.username}». ` +
          'Inactívelo primero o asócielo manualmente.',
      };
    }
    return {
      estado: 'AUTO',
      comercialId: comercial.id,
      comercialNombre: comercial.nombre,
      mensaje: `Asociado automáticamente al comercial «${comercial.nombre}» por coincidencia de nombre`,
    };
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
