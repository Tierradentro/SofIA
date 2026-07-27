import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Estados de la actividad de ingreso (M07/CU-001). */
export enum InboundStatus {
  /** Generador creó la actividad (factura OCR validada o datos manuales). */
  CREADO = 'CREADO',
  /** Operador tomó la tarea y está registrando la recepción. */
  EN_INGRESO = 'EN_INGRESO',
  /** Diferencias o productos nuevos: bloquea el cierre definitivo (HU-025). */
  PENDIENTE_CORRECCION = 'PENDIENTE_CORRECCION',
  /** Generador aprobó: existencias actualizadas por movimientos. */
  APROBADO = 'APROBADO',
  CANCELADO = 'CANCELADO',
}

/**
 * Actividad de ingreso de mercancía (M07, HU-022).
 * Multiempresa: cada ingreso pertenece a UNA empresa y sus productos
 * se matchean/crean dentro de esa empresa (regla transversal).
 */
@Entity('inbound_receipts')
@Index(['empresaId', 'estado'])
export class InboundReceipt {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'numero_factura', length: 60, nullable: true })
  numeroFactura: string | null;

  @Column({ name: 'fecha_factura', type: 'date', nullable: true })
  fechaFactura: string | null;

  @Column({ length: 200, nullable: true })
  proveedor: string | null;

  @Column({
    type: 'enum',
    enum: InboundStatus,
    enumName: 'inbound_status_enum',
    default: InboundStatus.CREADO,
  })
  estado: InboundStatus;

  /** HU-023: código de la caja principal / contenedor (trazabilidad recepción). */
  @Column({ name: 'caja_principal', length: 80, nullable: true })
  cajaPrincipal: string | null;

  /** Documento OCR origen (HU-022); null cuando el ingreso es manual. */
  @Column({ name: 'ocr_document_id', type: 'uuid', nullable: true })
  ocrDocumentId: string | null;

  /** El Operador cerró el conteo (paso 4: comparación factura vs. recibido). */
  @Column({ name: 'conteo_cerrado', default: false })
  conteoCerrado: boolean;

  /** HU-026: observación obligatoria al aprobar con diferencias o productos nuevos. */
  @Column({ name: 'observacion_diferencias', type: 'text', nullable: true })
  observacionDiferencias: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'iniciado_por', type: 'uuid', nullable: true })
  iniciadoPor: string | null;

  @Column({ name: 'aprobado_por', type: 'uuid', nullable: true })
  aprobadoPor: string | null;

  @Column({ name: 'motivo_cancelacion', type: 'text', nullable: true })
  motivoCancelacion: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'iniciado_at', type: 'timestamptz', nullable: true })
  iniciadoAt: Date | null;

  @Column({ name: 'aprobado_at', type: 'timestamptz', nullable: true })
  aprobadoAt: Date | null;

  @Column({ name: 'cancelado_at', type: 'timestamptz', nullable: true })
  canceladoAt: Date | null;
}
