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
import { WarehouseAisle } from './warehouse-aisle.entity';

/**
 * Zona de un pasillo (HU-014, EP-11). Cada lado del pasillo es una zona:
 * izquierda, derecha o fondo. La zona agrupa los estantes de ese lado y se
 * muestra con alias y color en el mapa 2D. El fondo es un solo espacio
 * (productos temporales), sin división en estantes/niveles.
 */
export enum ZonaLado {
  IZQUIERDA = 'IZQUIERDA',
  DERECHA = 'DERECHA',
  FONDO = 'FONDO',
}

@Entity('warehouse_zones')
@Unique(['aisleId', 'lado'])
export class WarehouseZone {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'aisle_id' })
  aisleId: string;

  @ManyToOne(() => WarehouseAisle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'aisle_id' })
  aisle: WarehouseAisle;

  @Column({ type: 'enum', enum: ZonaLado, enumName: 'warehouse_zone_lado_enum' })
  lado: ZonaLado;

  @Column({ length: 120, nullable: true })
  alias: string;

  @Column({ length: 30, nullable: true })
  color: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
