import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Estados del caso de devolución (Spec §6: Devolución). */
export enum PqrsStatus {
  ABIERTA = 'ABIERTA',
  PENDIENTE_CORRECCION = 'PENDIENTE_CORRECCION',
  CERRADA = 'CERRADA',
  CANCELADA = 'CANCELADA',
}

export enum PqrsPriority {
  ALTA = 'ALTA',
  MEDIA = 'MEDIA',
  BAJA = 'BAJA',
}

/**
 * Caso PQRS / devolución (M11, HU-043). Clientes y comerciales son globales
 * (D-03); el producto puede ser de cualquiera de las dos empresas.
 * Casos PQRS es una de las 6 entidades con auditoría obligatoria.
 * El reingreso al inventario NO es automático: lo realiza el Generador
 * manualmente como movimiento REINGRESO_DEVOLUCION (M11 Solución).
 */
@Entity('pqrs_cases')
@Index(['estado'])
@Index(['clienteId'])
export class PqrsCase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cliente_id', type: 'uuid' })
  clienteId: string;

  @Column({ name: 'comercial_id', type: 'uuid', nullable: true })
  comercialId: string | null;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Snapshots del producto (trazabilidad, campos M11). */
  @Column({ length: 60 })
  codigo: string;

  @Column({ length: 120, nullable: true })
  marca: string | null;

  @Column({ length: 250 })
  descripcion: string;

  @Column({ type: 'int', default: 1 })
  cantidad: number;

  /** Factura asociada (del pedido encontrado o manual, HU-045). */
  @Column({ length: 60, nullable: true })
  factura: string | null;

  /** true cuando la factura se digitó manualmente (sin coincidencia, HU-045). */
  @Column({ name: 'factura_manual', default: false })
  facturaManual: boolean;

  /** CU-007: sin factura ni pedido, la observación es obligatoria. */
  @Column({ name: 'factura_observacion', type: 'text', nullable: true })
  facturaObservacion: string | null;

  /** Motivo de devolución (catálogo G01–G40 / N01–N18, HU-047). */
  @Column({ name: 'motivo_codigo', length: 4 })
  motivoCodigo: string;

  @Column({ type: 'text', nullable: true })
  detalle: string | null;

  @Column({ name: 'descripcion_caso', type: 'text' })
  descripcionCaso: string;

  /** Resultado de la validación registrado por el Operador al cerrar (M11). */
  @Column({ name: 'solucion_caso', type: 'text', nullable: true })
  solucionCaso: string | null;

  @Column({ length: 60, nullable: true })
  documento: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @Column({
    type: 'enum',
    enum: PqrsPriority,
    enumName: 'pqrs_priority_enum',
    default: PqrsPriority.MEDIA,
  })
  prioridad: PqrsPriority;

  @Column({
    type: 'enum',
    enum: PqrsStatus,
    enumName: 'pqrs_status_enum',
    default: PqrsStatus.ABIERTA,
  })
  estado: PqrsStatus;

  /** Asociaciones confirmadas por el Operador (HU-044, CU-006). */
  @Column({ name: 'order_id', type: 'uuid', nullable: true })
  orderId: string | null;

  @Column({ name: 'dispatch_id', type: 'uuid', nullable: true })
  dispatchId: string | null;

  @Column({ name: 'box_id', length: 20, nullable: true })
  boxId: string | null;

  /** Reingreso al inventario por el Generador (movimiento REINGRESO_DEVOLUCION). */
  @Column({ name: 'cantidad_reingresada', type: 'int', default: 0 })
  cantidadReingresada: number;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'corregido_por', type: 'uuid', nullable: true })
  corregidoPor: string | null;

  @Column({ name: 'cerrado_por', type: 'uuid', nullable: true })
  cerradoPor: string | null;

  @Column({ name: 'motivo_cancelacion', type: 'text', nullable: true })
  motivoCancelacion: string | null;

  /** Fecha Inicio (M11). */
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Fecha Cierre (M11). */
  @Column({ name: 'cerrada_at', type: 'timestamptz', nullable: true })
  cerradaAt: Date | null;

  @Column({ name: 'cancelado_at', type: 'timestamptz', nullable: true })
  canceladoAt: Date | null;
}
