import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** Ciclo del pedido (M08, respuesta 4.2): ABIERTO → ALISTADO → APROBADO. */
export enum OrderStatus {
  ABIERTO = 'ABIERTO',
  ALISTADO = 'ALISTADO',
  APROBADO = 'APROBADO',
  PENDIENTE_CORRECCION = 'PENDIENTE_CORRECCION',
  CANCELADO = 'CANCELADO',
  /** I25: el pedido salió despachado por completo (ya no es asociable). */
  DESPACHADO = 'DESPACHADO',
}

/**
 * Pedido de venta (M08, HU-028). Por empresa (D-03), con consecutivo
 * independiente SIGLAS-#### (P-09). Clientes y comerciales son globales.
 * Pedidos es una de las 6 entidades con auditoría obligatoria.
 */
@Entity('orders')
@Unique(['empresaId', 'numero'])
@Index(['empresaId', 'estado'])
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  /** Consecutivo visible SIGLAS-#### (independiente por empresa). */
  @Column({ length: 20 })
  numero: string;

  /** Número de orden de pedido del cliente (documento origen). */
  @Column({ name: 'orden_pedido', length: 60, nullable: true })
  ordenPedido: string | null;

  @Column({ length: 120, nullable: true })
  ciudad: string | null;

  /** QA Func. 4.1: dirección a la que va el despacho (foto al crear el pedido). */
  @Column({ name: 'direccion_despacho', length: 250, nullable: true })
  direccionDespacho: string | null;

  @Column({ name: 'cliente_id', type: 'uuid' })
  clienteId: string;

  /** Comercial asociado (automático cuando crea un usuario Comercial, M06). */
  @Column({ name: 'comercial_id', type: 'uuid', nullable: true })
  comercialId: string | null;

  /** Notas (descuentos y observaciones de la negociación, M08). */
  @Column({ type: 'text', nullable: true })
  notas: string | null;

  /** Factura de venta asociada al confirmar (HU-032). */
  @Column({ name: 'numero_factura', length: 60, nullable: true })
  numeroFactura: string | null;

  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status_enum',
    default: OrderStatus.ABIERTO,
  })
  estado: OrderStatus;

  /** Documento OCR de la orden/cotización origen (HU-028). */
  @Column({ name: 'ocr_document_id', type: 'uuid', nullable: true })
  ocrDocumentId: string | null;

  /** H-7 (spec §7): procedencia del pedido — manual, OCR, Excel o API. */
  @Column({ name: 'created_via', length: 10, default: 'MANUAL' })
  createdVia: 'MANUAL' | 'OCR' | 'EXCEL' | 'API';

  /** Documento OCR de la factura de venta (HU-032). */
  @Column({ name: 'factura_ocr_document_id', type: 'uuid', nullable: true })
  facturaOcrDocumentId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'alistado_por', type: 'uuid', nullable: true })
  alistadoPor: string | null;

  @Column({ name: 'aprobado_por', type: 'uuid', nullable: true })
  aprobadoPor: string | null;

  @Column({ name: 'motivo_cancelacion', type: 'text', nullable: true })
  motivoCancelacion: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'alistado_at', type: 'timestamptz', nullable: true })
  alistadoAt: Date | null;

  @Column({ name: 'aprobado_at', type: 'timestamptz', nullable: true })
  aprobadoAt: Date | null;

  @Column({ name: 'cancelado_at', type: 'timestamptz', nullable: true })
  canceladoAt: Date | null;
}
