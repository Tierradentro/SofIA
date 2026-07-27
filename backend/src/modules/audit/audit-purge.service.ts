import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { AuditLog } from './entities/audit-log.entity';
import { AuditService } from './audit.service';

/**
 * Purga administrativa de auditoría (A-03 / M15):
 * 1. Exporta el rango completo a CSV (obligatorio, antes de borrar).
 * 2. Borra dentro de una transacción con SET LOCAL audit.allow_purge='on'
 *    (único bypass del trigger append-only).
 * 3. Auto-audita la purga (quién, cuándo, rango, archivo, cantidad).
 */
@Injectable()
export class AuditPurgeService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  async purge(
    fechaDesde: string,
    fechaHasta: string,
    motivo: string,
    admin: { id: string; username: string },
  ) {
    const desde = new Date(fechaDesde);
    const hasta = new Date(fechaHasta);
    if (isNaN(desde.getTime()) || isNaN(hasta.getTime()) || desde > hasta) {
      throw new BadRequestException('Rango de fechas inválido');
    }

    const repo = this.dataSource.getRepository(AuditLog);
    const rows = await repo
      .createQueryBuilder('a')
      .where('a.fecha_hora BETWEEN :desde AND :hasta', { desde, hasta })
      .orderBy('a.fecha_hora', 'ASC')
      .getMany();
    if (rows.length === 0) {
      throw new BadRequestException('No hay logs en el rango indicado');
    }

    // 1. Exportación previa obligatoria
    const exportsDir = process.env.EXPORTS_DIR || '/tmp/sofia-exports';
    mkdirSync(exportsDir, { recursive: true });
    const fileName = `audit-purge-${Date.now()}.csv`;
    const filePath = join(exportsDir, fileName);
    await this.exportCsv(rows, filePath);

    // 2. Borrado transaccional con bypass controlado del trigger
    const ids = rows.map((r) => r.id);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(`SET LOCAL audit.allow_purge = 'on'`);
      await manager
        .createQueryBuilder()
        .delete()
        .from(AuditLog)
        .where('id IN (:...ids)', { ids })
        .execute();
    });

    // 3. Auto-auditoría de la purga (fuera de la transacción de borrado)
    await this.auditService.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'PURGA_AUDITORIA',
      tabla: 'audit_logs',
      registroId: null,
      valorAnterior: { registros: rows.length, fechaDesde, fechaHasta },
      valorNuevo: { archivoExportado: fileName },
      motivo,
    });

    return { exportado: fileName, registrosPurgados: rows.length };
  }

  /**
   * I14: resuelve la ruta de un respaldo de purga para descarga. Valida el
   * nombre para evitar path traversal (solo archivos audit-purge-*.csv del
   * directorio de exportación).
   */
  resolveExportPath(archivo: string): string {
    if (!/^audit-purge-\d+\.csv$/.test(archivo)) {
      throw new BadRequestException('Nombre de respaldo inválido');
    }
    const exportsDir = process.env.EXPORTS_DIR || '/tmp/sofia-exports';
    const filePath = join(exportsDir, archivo);
    if (!existsSync(filePath)) {
      throw new NotFoundException('Respaldo no encontrado');
    }
    return filePath;
  }

  /** Lista los respaldos de purga disponibles (nombre, tamaño, fecha). */
  listExports() {
    const exportsDir = process.env.EXPORTS_DIR || '/tmp/sofia-exports';
    mkdirSync(exportsDir, { recursive: true });
    return readdirSync(exportsDir)
      .filter((f) => /^audit-purge-\d+\.csv$/.test(f))
      .map((f) => {
        const st = statSync(join(exportsDir, f));
        return { archivo: f, bytes: st.size, creado: st.mtime };
      })
      .sort((a, b) => b.creado.getTime() - a.creado.getTime());
  }

  private exportCsv(rows: AuditLog[], filePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = createWriteStream(filePath, { encoding: 'utf8' });
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      stream.write(
        'id,usuario_id,usuario_username,fecha_hora,accion,tabla,registro_id,valor_anterior,valor_nuevo,motivo\n',
      );
      const esc = (v: any) => {
        if (v === null || v === undefined) return '';
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return `"${s.replace(/"/g, '""')}"`;
      };
      for (const r of rows) {
        stream.write(
          [
            r.id,
            esc(r.usuarioId),
            esc(r.usuarioUsername),
            esc(r.fechaHora?.toISOString?.() ?? r.fechaHora),
            esc(r.accion),
            esc(r.tabla),
            esc(r.registroId),
            esc(r.valorAnterior),
            esc(r.valorNuevo),
            esc(r.motivo),
          ].join(',') + '\n',
        );
      }
      stream.end();
    });
  }
}
