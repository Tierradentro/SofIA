import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** Ciclo de la jornada de inventario (M12). */
export enum StockCountStatus {
  /** Creado: snapshot tomado; bloqueos de alistamiento/despacho/ingreso activos. */
  EN_CONTEO = 'EN_CONTEO',
  /** Operador finalizó el conteo; pendiente de aprobación del Generador. */
  PENDIENTE_APROBACION = 'PENDIENTE_APROBACION',
  /** Generador aprobó: existencias actualizadas con movimientos AJUSTE_INVENTARIO. */
  APROBADO = 'APROBADO',
  /** Cancelado con motivo: existencias sin cambio (HU-052). */
  CANCELADO = 'CANCELADO',
}

/**
 * Jornada de inventario por empresa (M12, HU-048). Al crearla, el sistema
 * toma un snapshot de las existencias de los productos incluidos (la
 * comparación del conteo es contra ese snapshot, no contra la existencia
 * cambiante). Mientras esté EN_CONTEO se bloquean el alistamiento, el
 * despacho y el ingreso de los productos incluidos para la empresa; crear
 * y aprobar pedidos sí está permitido (su alistamiento espera).
 * Inventarios es una de las 6 entidades con auditoría obligatoria.
 */
@Entity('stock_counts')
@Index(['empresaId', 'estado'])
export class StockCount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** La jornada es de UNA empresa: nunca mezcla productos (HU-048). */
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ length: 20 })
  numero: string;

  /** Instrucción de los productos a inventariar, escrita por el Generador (M12). */
  @Column({ type: 'text' })
  instruccion: string;

  @Column({
    type: 'enum',
    enum: StockCountStatus,
    enumName: 'stock_count_status_enum',
    default: StockCountStatus.EN_CONTEO,
  })
  estado: StockCountStatus;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @Column({ name: 'cerrado_por', type: 'uuid', nullable: true })
  cerradoPor: string | null;

  @Column({ name: 'aprobado_por', type: 'uuid', nullable: true })
  aprobadoPor: string | null;

  @Column({ name: 'motivo_cancelacion', type: 'text', nullable: true })
  motivoCancelacion: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'cerrado_at', type: 'timestamptz', nullable: true })
  cerradoAt: Date | null;

  @Column({ name: 'aprobado_at', type: 'timestamptz', nullable: true })
  aprobadoAt: Date | null;

  @Column({ name: 'cancelado_at', type: 'timestamptz', nullable: true })
  canceladoAt: Date | null;
}
