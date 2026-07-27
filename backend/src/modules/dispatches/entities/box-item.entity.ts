import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Contenido de una caja (M09 paso 3/4). El escaneo SOLO acumula conteo
 * (regla transversal): las existencias se descuentan al cerrar la caja.
 * Trazabilidad por ítem: empresa, pedido y documento de origen (HU-034).
 */
@Entity('box_items')
@Unique(['boxId', 'orderItemId'])
@Index(['boxId'])
export class BoxItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** FK a boxes.id (no al boxId visible). */
  @Column({ name: 'box_id', type: 'uuid' })
  boxId: string;

  /** Línea de pedido empacada (resuelve producto, pedido y empresa). */
  @Column({ name: 'order_item_id', type: 'uuid' })
  orderItemId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Empresa del ítem (una caja puede mezclar empresas, M09 paso 3). */
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ length: 60 })
  codigo: string;

  /** Conteo acumulado por escaneo (HU-036). */
  @Column({ type: 'int', default: 0 })
  cantidad: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
