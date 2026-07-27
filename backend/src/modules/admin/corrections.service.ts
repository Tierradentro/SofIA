import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CorrectionDto } from './dto/correction.dto';

/**
 * HU-064 / CU-012: corrección administrativa controlada.
 * - Whitelist estricta de tablas y campos corregibles (nada de SQL dinámico libre).
 * - La whitelist crece en cada iteración con las nuevas entidades auditables.
 * - Sin motivo no guarda. Registra valor anterior y nuevo en auditoría.
 * - PROHIBIDO aquí: cualquier corrección de existencias de producto — esas van
 *   siempre por movimientos de inventario (regla transversal, D-01).
 */
const CORRECTIBLE: Record<string, { pk: string; fields: string[] }> = {
  users: {
    pk: 'id',
    fields: ['nombre', 'descripcion', 'email'],
  },
  companies: {
    pk: 'id',
    fields: ['nombre', 'siglas', 'descripcion', 'identificacion', 'direccion', 'telefonos', 'ciudad'],
  },
};

@Injectable()
export class CorrectionsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  listCorrectible() {
    return Object.entries(CORRECTIBLE).map(([tabla, cfg]) => ({
      tabla,
      campos: cfg.fields,
    }));
  }

  async correct(dto: CorrectionDto, admin: { id: string; username: string }) {
    const cfg = CORRECTIBLE[dto.tabla];
    if (!cfg) {
      throw new BadRequestException(
        `La tabla '${dto.tabla}' no admite correcciones administrativas`,
      );
    }
    if (!cfg.fields.includes(dto.campo)) {
      throw new BadRequestException(
        `El campo '${dto.campo}' no es corregible en '${dto.tabla}'`,
      );
    }

    // Identificadores seguros: provienen exclusivamente de la whitelist
    const rows = await this.dataSource.query(
      `SELECT * FROM "${dto.tabla}" WHERE "${cfg.pk}" = $1`,
      [dto.registroId],
    );
    if (rows.length === 0) {
      throw new NotFoundException('Registro no encontrado');
    }
    const anterior = rows[0];
    const valorAnterior = anterior[dto.campo];

    await this.dataSource.query(
      `UPDATE "${dto.tabla}" SET "${dto.campo}" = $1, "updated_at" = now() WHERE "${cfg.pk}" = $2`,
      [dto.valorNuevo, dto.registroId],
    );

    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CORRECCION_ADMIN',
      tabla: dto.tabla,
      registroId: dto.registroId,
      valorAnterior: { [dto.campo]: valorAnterior },
      valorNuevo: { [dto.campo]: dto.valorNuevo },
      motivo: dto.motivo,
    });

    return {
      tabla: dto.tabla,
      registroId: dto.registroId,
      campo: dto.campo,
      valorAnterior,
      valorNuevo: dto.valorNuevo,
    };
  }
}
