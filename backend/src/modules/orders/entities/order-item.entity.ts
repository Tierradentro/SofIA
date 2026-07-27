import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Order } from './order.entity';

/**
 * Línea de pedido (M08): Código, Marca, Descripción, Cantidad, Valor Unidad,
 * Valor Total. `cantidadAlistada` acumula el conteo del escaneo (HU-030);
 * el bloqueo de existencias se registra como movimientos BLOQUEO_ALISTAMIENTO.
 */
@Entity('order_items')
@Index(['orderId'])
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Snapshots del producto al momento del pedido (trazabilidad). */
  @Column({ length: 60 })
  codigo: string;

  @Column({ length: 120, nullable: true })
  marca: string | null;

  @Column({ length: 250 })
  descripcion: string;

  @Column({ type: 'int' })
  cantidad: number;

  /** Unidades alistadas por escaneo/manual (HU-030/HU-031). */
  @Column({ name: 'cantidad_alistada', type: 'int', default: 0 })
  cantidadAlistada: number;

  /** Acumulado despachado en cajas cerradas (M09; pendiente = alistada − despachada). */
  @Column({ name: 'cantidad_despachada', type: 'int', default: 0 })
  cantidadDespachada: number;

  /** Valor unidad: sugerido del producto, editable por la negociación (M08). */
  @Column({ name: 'valor_unidad', type: 'numeric', precision: 14, scale: 2, default: 0 })
  valorUnidad: number;

  @Column({ name: 'valor_total', type: 'numeric', precision: 14, scale: 2, default: 0 })
  valorTotal: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
