import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

/**
 * Ítem de inventario (M12): snapshot de existencia al crear la jornada
 * (`existenciaSnapshot`), conteo físico del Operador con ubicación en
 * bodega (HU-049), diferencia calculada (Conteo − Existencia, HU-050) y
 * documentación de la diferencia por el Generador al aprobar (HU-051).
 */
@Entity('stock_count_items')
@Unique(['countId', 'productId'])
@Index(['countId'])
export class StockCountItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'count_id', type: 'uuid' })
  countId: string;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  /** Snapshots del producto (trazabilidad). */
  @Column({ length: 60 })
  codigo: string;

  @Column({ length: 250 })
  descripcion: string;

  /** Existencia del sistema al crear la jornada (comparación contra este valor). */
  @Column({ name: 'existencia_snapshot', type: 'int' })
  existenciaSnapshot: number;

  /** Precio del snapshot para el valor estimado de la diferencia (HU-050). */
  @Column({ name: 'precio_snapshot', type: 'numeric', precision: 14, scale: 2, default: 0 })
  precioSnapshot: number;

  /** Conteo físico del Operador (null = aún no contado). */
  @Column({ type: 'int', nullable: true })
  conteo: number | null;

  /** Ubicación en bodega registrada por el Operador (HU-049). */
  @Column({ length: 60, nullable: true })
  ubicacion: string | null;

  /** Documentación de la diferencia por el Generador (obligatoria si hay diferencia). */
  @Column({ name: 'nota_diferencia', type: 'text', nullable: true })
  notaDiferencia: string | null;

  @Column({ name: 'contado_por', type: 'uuid', nullable: true })
  contadoPor: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'contado_at', type: 'timestamptz', nullable: true })
  contadoAt: Date | null;
}
