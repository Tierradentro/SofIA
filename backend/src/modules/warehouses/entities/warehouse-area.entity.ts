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
 * Área fija de la bodega (HU-014, EP-11). Rectángulos de contexto en el mapa
 * 2D del piso 1: patio de maniobras, bahía de empaque y bahía de
 * almacenamiento temporal. La entrada es una línea (apertura en el
 * perímetro), no un rectángulo. La bahía temporal puede tener productos;
 * entrada y patio no.
 */
export enum AreaTipo {
  ENTRADA = 'ENTRADA',
  PATIO_MANIOBRAS = 'PATIO_MANIOBRAS',
  BAHIA_EMPAQUE = 'BAHIA_EMPAQUE',
  BAHIA_TEMPORAL = 'BAHIA_TEMPORAL',
}

@Entity('warehouse_areas')
@Unique(['floorId', 'tipo'])
export class WarehouseArea {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'floor_id' })
  floorId: string;

  @ManyToOne(() => WarehouseFloor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'floor_id' })
  floor: WarehouseFloor;

  @Column({ type: 'enum', enum: AreaTipo, enumName: 'warehouse_area_tipo_enum' })
  tipo: AreaTipo;

  @Column({ length: 120, nullable: true })
  alias: string;

  /** Posición del cajón en el lienzo (metros). La entrada usa ancho= línea. */
  @Column({ name: 'pos_x', type: 'float', default: 0 })
  posX: number;

  @Column({ name: 'pos_y', type: 'float', default: 0 })
  posY: number;

  @Column({ name: 'ancho_m', type: 'float', default: 8 })
  anchoM: number;

  @Column({ name: 'alto_m', type: 'float', default: 4 })
  altoM: number;

  /** Solo la bahía temporal (y empaque en proceso) almacenan productos. */
  @Column({ name: 'permite_productos', default: false })
  permiteProductos: boolean;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
