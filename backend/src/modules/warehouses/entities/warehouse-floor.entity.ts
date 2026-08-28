import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Warehouse } from './warehouse.entity';

/**
 * Piso de la bodega (HU-014). El piso 1 contiene las áreas fijas (entrada,
 * patio de maniobras, bahía de empaque, bahía temporal) además de los
 * pasillos; los pisos superiores solo cubren el área de los pasillos y se
 * dibujan en una pestaña separada del mapa 2D.
 */
@Entity('warehouse_floors')
@Unique(['warehouseId', 'numero'])
export class WarehouseFloor {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'warehouse_id' })
  warehouseId: string;

  @ManyToOne(() => Warehouse, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'warehouse_id' })
  warehouse: Warehouse;

  /** Número de piso: 1 = planta baja. */
  @Column({ type: 'int' })
  numero: number;

  @Column({ length: 120, nullable: true })
  alias: string;

  /** Solo el piso 1 tiene entrada/patio/bahías; los superiores no (mapa 2D). */
  @Column({ name: 'tiene_areas_fijas', default: false })
  tieneAreasFijas: boolean;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
