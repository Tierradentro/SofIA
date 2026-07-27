import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ImportType } from '../../../common/enums/import-type.enum';

/**
 * M-11: la validación del archivo es síncrona y ocurre ANTES de persistir el
 * job, así que VALIDANDO nunca sería un estado persistido real; el ciclo de
 * vida del registro arranca en PENDIENTE_APROBACION. El enum de PostgreSQL
 * conserva el valor (histórico), pero el dominio no lo expone.
 */
export enum ImportJobStatus {
  PENDIENTE_APROBACION = 'PENDIENTE_APROBACION',
  APLICADO = 'APLICADO',
  RECHAZADO = 'RECHAZADO',
}

/**
 * Trabajo de importación contable (D-14, M18).
 * Flujo: carga → validación de estructura y mapeo declarativo (HU-016) →
 * resumen con diferencias → aprobación (Administrador para CANTIDADES) →
 * aplicación. Las cantidades se ajustan vía movimientos AJUSTE_IMPORTACION,
 * nunca sobrescribiendo el campo cantidad (regla transversal).
 */
@Entity('import_jobs')
export class ImportJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'enum', enum: ImportType, enumName: 'import_type_enum' })
  tipo: ImportType;

  /** Requerida para PRODUCTOS y CANTIDADES; null en CLIENTES/COMERCIALES. */
  @Column({ name: 'empresa_id', type: 'uuid', nullable: true })
  empresaId: string | null;

  /** Documento con el archivo original (tabla documents, I2). */
  @Column({ name: 'document_id', type: 'uuid', nullable: true })
  documentId: string | null;

  @Column({ name: 'nombre_archivo', length: 250 })
  nombreArchivo: string;

  /** Mapeo declarativo: { columnaExcel: campoDestino } (M18). */
  @Column({ type: 'jsonb' })
  mapeo: Record<string, string>;

  /** Resultado de la validación (HU-016): columnas, filas, duplicados, diferencias. */
  @Column({ type: 'jsonb', nullable: true })
  resumen: Record<string, any> | null;

  @Column({
    type: 'enum',
    enum: ImportJobStatus,
    enumName: 'import_job_status_enum',
    default: ImportJobStatus.PENDIENTE_APROBACION,
  })
  estado: ImportJobStatus;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'aprobado_por', type: 'uuid', nullable: true })
  aprobadoPor: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
