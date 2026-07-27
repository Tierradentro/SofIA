import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Document } from '../../documents/entities/document.entity';
import { DocumentType } from '../../../common/enums/document-type.enum';

export enum OcrEngine {
  OCR_LOCAL = 'OCR_LOCAL',
  OCR_LLM = 'OCR_LLM',
}

export enum OcrDocumentStatus {
  /** Extraído y pendiente de validación del Generador (HU-021). */
  CREADO = 'CREADO',
  /** Validado/confirmado por el Generador. */
  CONFIRMADO = 'CONFIRMADO',
}

/**
 * HU-021 / M13: resultado del procesamiento OCR de un documento.
 * La información extraída queda almacenada (datosExtraidos) y es editable
 * antes de confirmar (corrección manual, CU-009).
 */
@Entity('ocr_documents')
export class OcrDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'document_id', type: 'uuid' })
  @Index()
  documentId: string;

  @ManyToOne(() => Document, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({
    name: 'tipo_documento',
    type: 'enum',
    enum: DocumentType,
    enumName: 'document_type_enum',
  })
  tipoDocumento: DocumentType;

  /** Motor que procesó el documento (trazabilidad). */
  @Column({ type: 'enum', enum: OcrEngine, enumName: 'ocr_engine_enum' })
  motor: OcrEngine;

  /** Proveedor LLM usado (solo cuando motor = OCR_LLM). */
  @Column({ name: 'provider_id', type: 'uuid', nullable: true })
  providerId: string | null;

  @Column({
    type: 'enum',
    enum: OcrDocumentStatus,
    enumName: 'ocr_document_status_enum',
    default: OcrDocumentStatus.CREADO,
  })
  estado: OcrDocumentStatus;

  /** Confianza global 0..1 (OCR local); null cuando el motor no la reporta. */
  @Column({ type: 'numeric', precision: 4, scale: 3, nullable: true })
  confianza: number | null;

  /** Datos extraídos (editables antes de confirmar). */
  @Column({ name: 'datos_extraidos', type: 'jsonb' })
  datosExtraidos: Record<string, any>;

  @Column({ name: 'texto_crudo', type: 'text', nullable: true })
  textoCrudo: string | null;

  @Column({ name: 'empresa_id', type: 'uuid', nullable: true })
  empresaId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'confirmed_at', type: 'timestamptz', nullable: true })
  confirmedAt: Date | null;
}
