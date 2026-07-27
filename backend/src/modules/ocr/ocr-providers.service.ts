import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  OcrProvider,
  OcrProviderKind,
  OcrProviderStatus,
} from './entities/ocr-provider.entity';
import { AuditService } from '../audit/audit.service';
import {
  decryptSecret,
  encryptSecret,
} from '../../common/crypto/secret-crypto';

const TABLA = 'ocr_providers';

/** Enmascara la API key: últimos 4 caracteres visibles. */
export function maskApiKey(key: string): string {
  if (!key) return '';
  return key.length <= 4 ? '••••' : `••••••••${key.slice(-4)}`;
}

/**
 * HU-019: administración de proveedores LLM para OCR.
 * Regla M13: solo un proveedor ACTIVO (activación exclusiva, además de la
 * restricción única parcial en BD).
 */
@Injectable()
export class OcrProvidersService {
  constructor(
    @InjectRepository(OcrProvider)
    private readonly providers: Repository<OcrProvider>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    const all = await this.providers.find({
      order: { prioridad: 'ASC', createdAt: 'ASC' },
    });
    return all.map((p) => this.toResponse(p));
  }

  async create(
    dto: Partial<OcrProvider>,
    admin: { id: string; username: string },
  ) {
    if (!dto.proveedor || !Object.values(OcrProviderKind).includes(dto.proveedor)) {
      throw new BadRequestException(
        `proveedor debe ser uno de: ${Object.values(OcrProviderKind).join(', ')}`,
      );
    }
    if (!dto.nombre?.trim()) throw new BadRequestException('nombre requerido');
    if (!dto.modelo?.trim()) throw new BadRequestException('modelo requerido');
    if (!dto.apiKey?.trim()) throw new BadRequestException('apiKey requerida');

    // C-4: la clave se persiste cifrada (AES-256-GCM); enmascarar con la
    // clave en claro para el log de auditoría (nunca se audita el cifrado)
    const saved = await this.providers.save(
      this.providers.create({
        proveedor: dto.proveedor,
        nombre: dto.nombre.trim(),
        modelo: dto.modelo.trim(),
        apiKey: encryptSecret(dto.apiKey.trim()),
        estado: OcrProviderStatus.INACTIVO,
        prioridad: dto.prioridad ?? 100,
      }),
    );
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CONFIGURAR_OCR_PROVIDER',
      tabla: TABLA,
      registroId: saved.id,
      valorNuevo: { ...this.toResponse(saved), apiKeyMasked: maskApiKey(dto.apiKey.trim()) },
    });
    return this.toResponse(saved);
  }

  async update(
    id: string,
    dto: Partial<OcrProvider>,
    admin: { id: string; username: string },
  ) {
    const provider = await this.findOne(id);
    const anterior = this.toResponse(provider);
    if (dto.proveedor && !Object.values(OcrProviderKind).includes(dto.proveedor)) {
      throw new BadRequestException('proveedor inválido');
    }
    if (dto.proveedor) provider.proveedor = dto.proveedor;
    if (dto.nombre) provider.nombre = dto.nombre.trim();
    if (dto.modelo) provider.modelo = dto.modelo.trim();
    // apiKey vacía = conservar la actual (la UI nunca la muestra completa)
    if (dto.apiKey?.trim()) provider.apiKey = encryptSecret(dto.apiKey.trim());
    if (dto.prioridad !== undefined) provider.prioridad = dto.prioridad;
    const saved = await this.providers.save(provider);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'EDITAR_OCR_PROVIDER',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior,
      valorNuevo: this.toResponse(saved),
    });
    return this.toResponse(saved);
  }

  /** HU-019/M13: activación exclusiva en una transacción. */
  async activate(id: string, admin: { id: string; username: string }) {
    const provider = await this.findOne(id);
    const anteriorActivo = await this.providers.findOne({
      where: { estado: OcrProviderStatus.ACTIVO },
    });
    await this.dataSource.transaction(async (em) => {
      await em.update(
        OcrProvider,
        { estado: OcrProviderStatus.ACTIVO },
        { estado: OcrProviderStatus.INACTIVO },
      );
      await em.update(
        OcrProvider,
        { id },
        { estado: OcrProviderStatus.ACTIVO },
      );
    });
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'ACTIVAR_OCR_PROVIDER',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anteriorActivo
        ? { id: anteriorActivo.id, nombre: anteriorActivo.nombre }
        : null,
      valorNuevo: { id: provider.id, nombre: provider.nombre },
    });
    const actualizado = await this.findOne(id);
    return this.toResponse(actualizado);
  }

  async deactivate(id: string, admin: { id: string; username: string }) {
    const provider = await this.findOne(id);
    provider.estado = OcrProviderStatus.INACTIVO;
    await this.providers.save(provider);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'DESACTIVAR_OCR_PROVIDER',
      tabla: TABLA,
      registroId: id,
      valorAnterior: { estado: 'ACTIVO' },
      valorNuevo: { estado: 'INACTIVO' },
    });
    return this.toResponse(provider);
  }

  async remove(id: string, admin: { id: string; username: string }) {
    const provider = await this.findOne(id);
    if (provider.estado === OcrProviderStatus.ACTIVO) {
      throw new BadRequestException(
        'No se puede eliminar el proveedor activo; active otro primero',
      );
    }
    await this.providers.remove(provider);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'ELIMINAR_OCR_PROVIDER',
      tabla: TABLA,
      registroId: id,
      valorAnterior: this.toResponse(provider),
    });
    return { eliminado: true };
  }

  async getActive(): Promise<OcrProvider | null> {
    return this.providers.findOne({
      where: { estado: OcrProviderStatus.ACTIVO },
    });
  }

  async findOne(id: string): Promise<OcrProvider> {
    const provider = await this.providers.findOne({ where: { id } });
    if (!provider) throw new NotFoundException('Proveedor OCR no encontrado');
    return provider;
  }

  /** Respuesta pública: nunca expone la API key completa. */
  toResponse(p: OcrProvider) {
    const { apiKey, ...rest } = p;
    // Enmascara sobre la clave en claro (descifrada), no sobre el cifrado
    return { ...rest, apiKeyMasked: maskApiKey(decryptSecret(apiKey)) };
  }
}
