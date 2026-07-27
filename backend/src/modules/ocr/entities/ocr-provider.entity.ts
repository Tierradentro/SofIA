import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Proveedores LLM soportados para OCR (M13). */
export enum OcrProviderKind {
  OPENAI = 'OPENAI',
  GEMINI = 'GEMINI',
  OPENROUTER = 'OPENROUTER',
}

export enum OcrProviderStatus {
  ACTIVO = 'ACTIVO',
  INACTIVO = 'INACTIVO',
}

/**
 * HU-019: configuración de un proveedor LLM para OCR.
 * Regla M13: se pueden registrar varios, pero solo uno queda ACTIVO
 * (se enforcea en el servicio con activación exclusiva).
 */
@Entity('ocr_providers')
export class OcrProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: OcrProviderKind,
    enumName: 'ocr_provider_kind_enum',
  })
  proveedor: OcrProviderKind;

  @Column({ length: 120 })
  nombre: string;

  @Column({ length: 120 })
  modelo: string;

  /** API Key del proveedor. Nunca se expone completa en respuestas (enmascarada). */
  @Column({ name: 'api_key', length: 512 })
  apiKey: string;

  @Column({
    type: 'enum',
    enum: OcrProviderStatus,
    enumName: 'ocr_provider_status_enum',
    default: OcrProviderStatus.INACTIVO,
  })
  estado: OcrProviderStatus;

  /** Menor valor = mayor prioridad (desempate al elegir candidato a activar). */
  @Column({ type: 'int', default: 100 })
  prioridad: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
