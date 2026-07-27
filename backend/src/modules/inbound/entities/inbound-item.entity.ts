import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { InboundReceipt } from './inbound-receipt.entity';

/**
 * Línea de una actividad de ingreso (M07): lo facturado por el proveedor
 * vs. lo efectivamente recibido (HU-024). `productId` queda null hasta
 * matchear o crearse el producto en la aprobación (paso 3/paso 5).
 */
@Entity('inbound_items')
@Index(['receiptId'])
export class InboundItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'receipt_id', type: 'uuid' })
  receiptId: string;

  @ManyToOne(() => InboundReceipt, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'receipt_id' })
  receipt: InboundReceipt;

  /** Referencia del proveedor/documento (puede ser código propio, OE o cruzada). */
  @Column({ length: 60 })
  referencia: string;

  @Column({ length: 250, nullable: true })
  descripcion: string | null;

  @Column({ length: 30, default: 'UND' })
  unidad: string;

  @Column({ name: 'cantidad_facturada', type: 'int' })
  cantidadFacturada: number;

  /** Cantidad registrada por el Operador (HU-024/HU-027). */
  @Column({ name: 'cantidad_recibida', type: 'int', default: 0 })
  cantidadRecibida: number;

  /** Producto matcheado (código/OE/cruzadas/barcode) o creado al aprobar. */
  @Column({ name: 'product_id', type: 'uuid', nullable: true })
  productId: string | null;

  /** true cuando el producto no existía: se crea automáticamente al aprobar (CU-001). */
  @Column({ name: 'es_nuevo', default: false })
  esNuevo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
