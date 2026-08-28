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
import { WarehouseZone } from './warehouse-zone.entity';

/**
 * Estante de una zona (HU-014, EP-11). Cada zona (lado del pasillo) puede
 * tener hasta N estantes; cada estante tiene entre 2 y N niveles. La zona de
 * fondo es un solo espacio y no tiene estantes. Los productos se asocian a
 * un nivel concreto de un estante.
 */
@Entity('warehouse_racks')
@Unique(['zoneId', 'numero'])
export class WarehouseRack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'zone_id' })
  zoneId: string;

  @ManyToOne(() => WarehouseZone, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'zone_id' })
  zone: WarehouseZone;

  /** Número de estante dentro de la zona. */
  @Column({ type: 'int' })
  numero: number;

  @Column({ length: 120, nullable: true })
  alias: string;

  /** Cantidad de niveles del estante (p. ej. 2 a 4). */
  @Column({ type: 'int', default: 3 })
  niveles: number;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
