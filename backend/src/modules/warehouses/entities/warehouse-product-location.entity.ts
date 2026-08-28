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
import { WarehouseRack } from './warehouse-rack.entity';
import { WarehouseArea } from './warehouse-area.entity';
import { Product } from '../../products/entities/product.entity';

/**
 * Ubicación de un producto en la bodega (HU-014/HU-059, EP-11/M16).
 * Un producto puede tener varias ubicaciones (multi-zona); la oficial es la
 * de mayor cantidad (es_oficial). La zona de tránsito es una ubicación sin
 * estante (producto que ingresó sin ubicación definida). Solo una de
 * rackId/areaId/transito está definida.
 */
@Entity('warehouse_product_locations')
@Unique(['productId', 'rackId', 'nivel'])
@Index(['productId'])
export class WarehouseProductLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'product_id' })
  productId: string;

  @ManyToOne(() => Product, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'product_id' })
  product: Product;

  /** Estante + nivel dentro de una zona (ubicación normal). */
  @Index()
  @Column({ name: 'rack_id', nullable: true })
  rackId: string;

  @ManyToOne(() => WarehouseRack, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'rack_id' })
  rack: WarehouseRack;

  /** Nivel dentro del estante (1 = nivel inferior). */
  @Column({ type: 'int', nullable: true })
  nivel: number;

  /** Área fija con productos (bahía temporal/empaque), si aplica. */
  @Column({ name: 'area_id', nullable: true })
  areaId: string;

  @ManyToOne(() => WarehouseArea, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'area_id' })
  area: WarehouseArea;

  /** true = zona de tránsito (sin ubicación definida). */
  @Column({ default: false })
  transito: boolean;

  @Column({ type: 'int', default: 0 })
  cantidad: number;

  /** Ubicación oficial del producto (donde hay mayoría de cantidad). */
  @Column({ name: 'es_oficial', default: false })
  esOficial: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
