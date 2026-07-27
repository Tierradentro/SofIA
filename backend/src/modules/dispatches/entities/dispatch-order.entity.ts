import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Pedidos asociados a un despacho (M09 paso 1, HU-034). Un pedido puede
 * aparecer en varios despachos a lo largo del tiempo (despacho adicional
 * para completar un parcial, D-06) pero solo en uno activo a la vez.
 */
@Entity('dispatch_orders')
@Unique(['dispatchId', 'orderId'])
@Index(['orderId'])
export class DispatchOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dispatch_id', type: 'uuid' })
  dispatchId: string;

  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  /** Empresa del pedido (trazabilidad multiempresa, HU-034). */
  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
