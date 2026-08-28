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
import { WarehouseFloor } from './warehouse-floor.entity';

/**
 * Pasillo de la bodega (HU-014, EP-11). Es un cajón rectangular dentro del
 * perímetro de la bodega; su posición (x,y) y tamaño se pueden mover en la
 * configuración del mapa 2D. En cada pasillo se ubican los estantes por lado
 * (izquierdo/derecho) y un fondo (zona temporal).
 */
@Entity('warehouse_aisles')
@Unique(['floorId', 'numero'])
export class WarehouseAisle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'floor_id' })
  floorId: string;

  @ManyToOne(() => WarehouseFloor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'floor_id' })
  floor: WarehouseFloor;

  /** Número de pasillo dentro del piso. */
  @Column({ type: 'int' })
  numero: number;

  @Column({ length: 120, nullable: true })
  alias: string;

  @Column({ length: 30, nullable: true })
  color: string;

  /**
   * Posición y tamaño del cajón en el lienzo de configuración (metros).
   * Configurables moviendo el cajón dentro de la forma de la bodega.
   */
  @Column({ name: 'pos_x', type: 'float', default: 0 })
  posX: number;

  @Column({ name: 'pos_y', type: 'float', default: 0 })
  posY: number;

  @Column({ name: 'ancho_m', type: 'float', default: 10 })
  anchoM: number;

  @Column({ name: 'alto_m', type: 'float', default: 4 })
  altoM: number;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
