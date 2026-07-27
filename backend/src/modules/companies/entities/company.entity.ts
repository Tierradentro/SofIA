import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Empresa (Spec M03). El sistema soporta N empresas (A-01);
 * IRE e ICV son el seed inicial de este despliegue.
 * siglas: componen el número visible de pedido SIGLAS-#### (P-09),
 * se solicitan obligatoriamente en el registro de la empresa.
 */
@Entity('companies')
export class Company {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 150 })
  nombre: string;

  @Column({ unique: true, length: 5 })
  siglas: string;

  @Column({ length: 250, nullable: true })
  descripcion: string;

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
