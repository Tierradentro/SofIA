import { Column, Entity, PrimaryColumn } from 'typeorm';

/** Consecutivo de despachos por empresa (SIGLAS-####, serie independiente). */
@Entity('dispatch_counters')
export class DispatchCounter {
  @PrimaryColumn({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ type: 'int', default: 0 })
  ultimo: number;
}

/**
 * Consecutivo GLOBAL de cajas (M09 paso 3: único y compartido para todas
 * las empresas). Una sola fila (id fijo 1).
 */
@Entity('box_counter')
export class BoxCounter {
  @PrimaryColumn({ type: 'int' })
  id: number;

  @Column({ type: 'int', default: 0 })
  ultimo: number;
}
