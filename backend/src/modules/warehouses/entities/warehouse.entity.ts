import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Bodega (HU-014, EP-11 / M16). Una sola bodega física compartida por las
 * empresas (IRE/ICV) en este despliegue. La forma define el perímetro dentro
 * del cual se ubican los cajones (pasillos y áreas fijas) del mapa 2D.
 * anchoM/altoM son las dimensiones en metros del lienzo de configuración.
 */
export enum BodegaForma {
  RECTANGULO = 'RECTANGULO',
  CUADRADO = 'CUADRADO',
}

@Entity('warehouses')
export class Warehouse {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 150 })
  nombre: string;

  @Column({ type: 'enum', enum: BodegaForma, enumName: 'warehouse_forma_enum', default: BodegaForma.RECTANGULO })
  forma: BodegaForma;

  /** Dimensiones del lienzo de configuración (metros), para el mapa 2D. */
  @Column({ name: 'ancho_m', type: 'int', default: 40 })
  anchoM: number;

  @Column({ name: 'alto_m', type: 'int', default: 30 })
  altoM: number;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
