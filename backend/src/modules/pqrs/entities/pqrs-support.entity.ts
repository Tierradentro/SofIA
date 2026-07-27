import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum PqrsSupportType {
  /** Evidencia fotográfica de la recepción de la devolución (HU-046). */
  RECEPCION = 'RECEPCION',
  /** Soporte de respuesta del proveedor al cerrar el caso (M11 Solución). */
  SOLUCION = 'SOLUCION',
}

/**
 * Soporte de un caso PQRS (M11 Soportes): una o varias imágenes con
 * observación. El archivo se almacena vía DocumentsService (SOPORTE_PQRS,
 * documento permanente, D-07).
 */
@Entity('pqrs_supports')
@Index(['caseId'])
export class PqrsSupport {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  /** Archivo almacenado (documents). */
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @Column({
    type: 'enum',
    enum: PqrsSupportType,
    enumName: 'pqrs_support_type_enum',
    default: PqrsSupportType.RECEPCION,
  })
  tipo: PqrsSupportType;

  @Column({ type: 'text', nullable: true })
  observacion: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
