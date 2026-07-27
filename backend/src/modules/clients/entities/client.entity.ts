import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Cliente (M04). Catálogo GLOBAL (D-03 confirmada): no tiene empresa_id;
 * la trazabilidad por empresa vive en pedidos y en ítems de caja.
 * Importable desde la maestra contable (I4).
 */
@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  nombre: string;

  @Column({ length: 60, nullable: true })
  identificacion: string;

  @Column({ length: 250, nullable: true })
  direccion: string;

  @Column({ length: 120, nullable: true })
  telefonos: string;

  @Column({ length: 120, nullable: true })
  ciudad: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
