import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, EntityManager, Repository } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';

export interface AuditEntry {
  usuarioId?: string | null;
  usuarioUsername?: string | null;
  accion: string;
  tabla: string;
  registroId?: string | null;
  valorAnterior?: Record<string, any> | null;
  valorNuevo?: Record<string, any> | null;
  motivo?: string | null;
}

export interface AuditQuery {
  usuarioId?: string;
  tabla?: string;
  accion?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  page?: number;
  limit?: number;
}

/** Campos que jamás deben quedar en auditoría (datos sensibles). */
const SENSITIVE_FIELDS = ['passwordHash', 'password_hash', 'password', 'clave', 'apiKey'];

export function sanitize(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_FIELDS.includes(k) ? '***' : sanitize(v);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  /**
   * Registra una acción en auditoría (Spec M15). Toda acción crítica sobre
   * Clientes, Productos, Inventarios, Pedidos, Despachos y Casos PQRS —
   * y además usuarios, empresas, correcciones y purgas — pasa por aquí.
   * La tabla es append-only a nivel de BD (trigger).
   */
  /**
   * @param manager EntityManager opcional: cuando la acción auditada ocurre
   * dentro de una transacción, el log debe escribirse con la MISMA conexión
   * (si no, espera otra conexión del pool y puede bloquearse con max=1).
   */
  async log(entry: AuditEntry, manager?: EntityManager): Promise<AuditLog> {
    const repo = manager ? manager.getRepository(AuditLog) : this.repo;
    const log = repo.create({
      usuarioId: entry.usuarioId ?? null,
      usuarioUsername: entry.usuarioUsername ?? null,
      accion: entry.accion,
      tabla: entry.tabla,
      registroId: entry.registroId ?? null,
      valorAnterior: sanitize(entry.valorAnterior) ?? null,
      valorNuevo: sanitize(entry.valorNuevo) ?? null,
      motivo: entry.motivo ?? null,
    });
    return repo.save(log);
  }

  /** Consulta de logs con filtros (HU-065, solo Administrador). */
  async query(q: AuditQuery) {
    const page = Math.max(1, q.page || 1);
    const limit = Math.min(200, Math.max(1, q.limit || 50));
    const where: any = {};
    if (q.usuarioId) where.usuarioId = q.usuarioId;
    if (q.tabla) where.tabla = q.tabla;
    if (q.accion) where.accion = q.accion;
    if (q.fechaDesde || q.fechaHasta) {
      const desde = q.fechaDesde ? new Date(q.fechaDesde) : new Date(0);
      const hasta = q.fechaHasta ? new Date(q.fechaHasta) : new Date('2999-12-31');
      where.fechaHora = Between(desde, hasta);
    }
    const [data, total] = await this.repo.findAndCount({
      where,
      order: { fechaHora: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { data, total, page, limit };
  }
}
