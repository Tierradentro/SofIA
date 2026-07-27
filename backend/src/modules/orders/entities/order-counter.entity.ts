import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Consecutivo de pedidos por empresa (P-09/M08): SIGLAS + 4 dígitos,
 * independiente por empresa. Se incrementa con UPSERT atómico dentro de la
 * transacción de creación del pedido (concurrencia segura).
 */
@Entity('order_counters')
export class OrderCounter {
  @PrimaryColumn({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ type: 'int', default: 0 })
  ultimo: number;
}
