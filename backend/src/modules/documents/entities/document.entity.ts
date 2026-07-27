import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DocumentType } from '../../../common/enums/document-type.enum';

/**
 * Documento almacenado (D-07, M13). Tabla polimórfica: owner_type/owner_id
 * referencian la entidad dueña (ingreso, pedido, despacho, PQRS, sistema).
 * es_temporal=false para facturas de importación/venta, soportes PQRS y logo
 * (permanentes); los demás pueden eliminarse tras confirmar la extracción.
 */
@Entity('documents')
@Index(['ownerType', 'ownerId'])
export class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Entidad dueña: 'system' (logo), 'inbound_receipt', 'order', 'pqrs_case', ... */
  @Column({ name: 'owner_type', length: 60 })
  ownerType: string;

  @Column({ name: 'owner_id', length: 80, nullable: true })
  ownerId: string | null;

  @Column({ type: 'enum', enum: DocumentType, enumName: 'document_type_enum' })
  tipo: DocumentType;

  /** Ruta relativa dentro del volumen de archivos (FILES_DIR). */
  @Column({ length: 500 })
  path: string;

  @Column({ name: 'nombre_original', length: 250 })
  nombreOriginal: string;

  @Column({ length: 120 })
  mime: string;

  @Column({ type: 'bigint' })
  size: number;

  @Column({ name: 'es_temporal', default: true })
  esTemporal: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
