import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Comercial (M06). Catálogo GLOBAL (D-03 confirmada).
 * Puede tener asociado un usuario con rol Comercial (M06/§4), quien solo
 * visualiza la información relacionada con ese comercial.
 */
@Entity('comerciales')
export class Comercial {
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
