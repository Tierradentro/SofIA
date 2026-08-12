import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { ApiKey } from './entities/api-key.entity';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { Role } from '../../common/enums/role.enum';

const TABLA = 'api_keys';

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function toMasked(k: ApiKey) {
  return {
    id: k.id,
    userId: k.userId,
    nombre: k.nombre,
    /** Enmascarada: solo prefijo visible (M17). */
    key: `${k.keyPrefix}${'•'.repeat(24)}`,
    activo: k.activo,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
  };
}

@Injectable()
export class ApiKeysService {
  constructor(
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Crea la key. La clave completa se retorna UNA sola vez; en BD solo
   * queda el hash y el prefijo. El usuario asociado debe tener rol API (M14).
   */
  async create(dto: CreateApiKeyDto, admin: { id: string; username: string }) {
    const user = await this.users.findOne({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    if (user.rol !== Role.API) {
      throw new BadRequestException(
        'Las API keys solo pueden asociarse a un usuario con rol API',
      );
    }
    const rawKey = `sk_${randomBytes(24).toString('hex')}`; // 51 chars
    const key = await this.apiKeys.save(
      this.apiKeys.create({
        userId: dto.userId,
        nombre: dto.nombre,
        keyHash: hashApiKey(rawKey),
        keyPrefix: rawKey.slice(0, 10),
        activo: true,
      }),
    );
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: key.id,
      valorNuevo: { nombre: key.nombre, userId: key.userId, keyPrefix: key.keyPrefix },
    });
    // La clave en claro solo viaja en esta respuesta
    return { ...toMasked(key), clave: rawKey };
  }

  async findAll() {
    const all = await this.apiKeys.find({ order: { createdAt: 'DESC' } });
    return all.map(toMasked);
  }

  async findOne(id: string) {
    const key = await this.apiKeys.findOne({ where: { id } });
    if (!key) throw new NotFoundException('API key no encontrada');
    return toMasked(key);
  }

  async update(id: string, dto: UpdateApiKeyDto, admin: { id: string; username: string }) {
    const key = await this.apiKeys.findOne({ where: { id } });
    if (!key) throw new NotFoundException('API key no encontrada');
    const anterior = { nombre: key.nombre, activo: key.activo };
    Object.assign(key, dto);
    const saved = await this.apiKeys.save(key);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'EDITAR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior,
      valorNuevo: { nombre: saved.nombre, activo: saved.activo },
    });
    return toMasked(saved);
  }

  /** M17: eliminar API key (auditado). */
  async remove(id: string, admin: { id: string; username: string }) {
    const key = await this.apiKeys.findOne({ where: { id } });
    if (!key) throw new NotFoundException('API key no encontrada');
    await this.apiKeys.remove(key);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'ELIMINAR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: { nombre: key.nombre, userId: key.userId, keyPrefix: key.keyPrefix },
    });
    return { eliminado: true };
  }

  /** Resuelve una key en crudo (header) al usuario API dueño. Base para el guard de I11. */
  async resolve(rawKey: string): Promise<ApiKey | null> {
    const key = await this.apiKeys.findOne({
      where: { keyHash: hashApiKey(rawKey), activo: true },
    });
    if (key) {
      key.lastUsedAt = new Date();
      await this.apiKeys.save(key);
    }
    return key;
  }
}
