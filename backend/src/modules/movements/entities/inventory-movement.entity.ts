import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MovementType } from '../../../common/enums/movement-type.enum';

/**
 * Libro mayor de movimientos de inventario (D-01, M18).
 * Toda variación de existencias (cantidad / cantidad_bloqueada) se origina
 * aquí, en la misma transacción que actualiza el saldo del producto.
 * Cada movimiento registra: empresa, usuario, fecha y documento origen
 * (regla Spec §3).
 */
@Entity('inventory_movements')
@Index(['productId', 'fecha'])
export class InventoryMovement {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  empresaId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @Column({ type: 'enum', enum: MovementType, enumName: 'movement_type_enum' })
  tipo: MovementType;

  /** Variación firmada sobre products.cantidad (0 si no aplica). */
  @Column({ name: 'cantidad_delta' })
  cantidadDelta: number;

  /** Variación firmada sobre products.cantidad_bloqueada (0 si no aplica). */
  @Column({ name: 'cantidad_bloqueada_delta' })
  cantidadBloqueadaDelta: number;

  /** Saldos resultantes tras aplicar el movimiento (trazabilidad). */
  @Column({ name: 'cantidad_resultante' })
  cantidadResultante: number;

  @Column({ name: 'bloqueada_resultante' })
  bloqueadaResultante: number;

  /** Documento origen: tipo (INGRESO, PEDIDO, DESPACHO, CAJA, INVENTARIO, IMPORTACION, PQRS, CORRECCION) e id. */
  @Column({ name: 'doc_tipo', length: 40, nullable: true })
  docTipo: string | null;

  @Column({ name: 'doc_id', length: 80, nullable: true })
  docId: string | null;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @CreateDateColumn({ name: 'fecha', type: 'timestamptz' })
  fecha: Date;
}
