import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum BoxStatus {
  ABIERTA = 'ABIERTA',
  CERRADA = 'CERRADA',
}

/**
 * Caja de despacho (M09 paso 3, HU-037). `boxId` es el consecutivo GLOBAL
 * único y compartido para todas las empresas (CJA-######): es lo único que
 * contiene el QR de la etiqueta (regla transversal). `numeroEnDespacho` es
 * el ordinal visible "Caja 1, Caja 2, ..." dentro del despacho.
 */
@Entity('boxes')
@Index(['dispatchId'])
export class Box {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** ID global único de caja (contenido del QR, HU-038). */
  @Column({ name: 'box_id', length: 20, unique: true })
  boxId: string;

  @Column({ name: 'dispatch_id', type: 'uuid' })
  dispatchId: string;

  /** Ordinal dentro del despacho: Caja 1, Caja 2, ... */
  @Column({ name: 'numero_en_despacho', type: 'int' })
  numeroEnDespacho: number;

  @Column({
    type: 'enum',
    enum: BoxStatus,
    enumName: 'box_status_enum',
    default: BoxStatus.ABIERTA,
  })
  estado: BoxStatus;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'cerrada_at', type: 'timestamptz', nullable: true })
  cerradaAt: Date | null;
}
