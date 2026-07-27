import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/** Ciclo del despacho (M09). */
export enum DispatchStatus {
  /** Generador creó el despacho y está asociando pedidos. */
  CREADO = 'CREADO',
  /** Generador aprobó: listo para empaque del Operador. */
  ABIERTO = 'ABIERTO',
  /** Operador devolvió el despacho al Generador por error de productos. */
  PENDIENTE_CORRECCION = 'PENDIENTE_CORRECCION',
  /** Empaque finalizado con pendientes: requiere aprobación del Generador (HU-041). */
  PARCIAL = 'PARCIAL',
  /** Transporte registrado (HU-039/040). Con pendientes = despacho parcial (D-06). */
  DESPACHADO = 'DESPACHADO',
  CANCELADO = 'CANCELADO',
}

export enum TransportType {
  EXTERNA = 'EXTERNA',
  INTERNA = 'INTERNA',
}

/**
 * Despacho (M09, HU-033). Consolida pedidos APROBADOS del mismo cliente
 * (pueden ser de varias empresas, HU-034/D-03 global). El consecutivo es
 * SIGLAS-#### de la empresa principal (la del primer pedido asociado),
 * con serie independiente por empresa. Despachos es una de las 6 entidades
 * con auditoría obligatoria.
 */
@Entity('dispatches')
@Unique(['numero'])
@Index(['estado'])
export class Dispatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Empresa principal: la del primer pedido; define el consecutivo. */
  /**
   * B-1: el despacho es GLOBAL (spec v1.1); empresa_id queda null en los
   * nuevos. La membresía por empresa vive en dispatch_orders.empresa_id.
   * La columna persiste por compatibilidad con filas históricas.
   */
  @Column({ name: 'empresa_id', type: 'uuid', nullable: true })
  empresaId: string | null;

  /** Consecutivo visible SIGLAS-#### (serie por empresa). */
  @Column({ length: 20 })
  numero: string;

  /** Todos los pedidos del despacho son de este cliente (HU-034). */
  @Column({ name: 'cliente_id', type: 'uuid' })
  clienteId: string;

  @Column({
    type: 'enum',
    enum: DispatchStatus,
    enumName: 'dispatch_status_enum',
    default: DispatchStatus.CREADO,
  })
  estado: DispatchStatus;

  /** El Operador finalizó el empaque (todas las cajas cerradas). */
  @Column({ name: 'empaque_finalizado', default: false })
  empaqueFinalizado: boolean;

  /** HU-041: aprobación del despacho parcial por el Generador. */
  @Column({ name: 'parcial_motivo', type: 'text', nullable: true })
  parcialMotivo: string | null;

  @Column({ name: 'parcial_aprobado_por', type: 'uuid', nullable: true })
  parcialAprobadoPor: string | null;

  @Column({ name: 'parcial_aprobado_at', type: 'timestamptz', nullable: true })
  parcialAprobadoAt: Date | null;

  /** Registro de transporte (HU-039/040). */
  @Column({
    name: 'tipo_transporte',
    type: 'enum',
    enum: TransportType,
    enumName: 'transport_type_enum',
    nullable: true,
  })
  tipoTransporte: TransportType | null;

  @Column({ name: 'carrier_id', type: 'uuid', nullable: true })
  carrierId: string | null;

  @Column({ length: 60, nullable: true })
  guia: string | null;

  @Column({ name: 'nombre_transporte', length: 150, nullable: true })
  nombreTransporte: string | null;

  @Column({ name: 'fecha_salida', type: 'timestamptz', nullable: true })
  fechaSalida: Date | null;

  /** D-06/HU-042: despacho adicional creado para completar un parcial. */
  @Column({ name: 'despacho_origen_id', type: 'uuid', nullable: true })
  despachoOrigenId: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'aprobado_por', type: 'uuid', nullable: true })
  aprobadoPor: string | null;

  @Column({ name: 'motivo_cancelacion', type: 'text', nullable: true })
  motivoCancelacion: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'despachado_at', type: 'timestamptz', nullable: true })
  despachadoAt: Date | null;

  @Column({ name: 'cancelado_at', type: 'timestamptz', nullable: true })
  canceladoAt: Date | null;
}
