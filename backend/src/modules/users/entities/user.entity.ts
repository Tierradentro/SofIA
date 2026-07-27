import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Role } from '../../../common/enums/role.enum';
import { UserStatus } from '../../../common/enums/user-status.enum';

/**
 * Usuario del sistema (Spec M02).
 * - Un solo rol por usuario (Spec §4).
 * - fecha_clave: última vez que cambió la clave (para expiración parametrizable).
 * - debe_cambiar_clave: obliga cambio en el próximo login (primer ingreso y reseteos).
 * - comercial_id: asociación 1:0..1 con comerciales (M06, FK se agrega en I3).
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 150 })
  nombre: string;

  @Column({ length: 150 })
  descripcion: string;

  @Column({ unique: true, length: 60 })
  username: string;

  @Column({ unique: true, length: 150 })
  email: string;

  @Column({ name: 'password_hash', length: 100 })
  passwordHash: string;

  @Column({ type: 'enum', enum: Role, enumName: 'user_role_enum' })
  rol: Role;

  @Column({
    type: 'enum',
    enum: UserStatus,
    enumName: 'user_status_enum',
    default: UserStatus.ACTIVO,
  })
  estado: UserStatus;

  @CreateDateColumn({ name: 'fecha_creacion', type: 'timestamptz' })
  fechaCreacion: Date;

  @Column({ name: 'fecha_clave', type: 'timestamptz', default: () => 'now()' })
  fechaClave: Date;

  @Column({ name: 'debe_cambiar_clave', default: true })
  debeCambiarClave: boolean;

  @Column({ name: 'intentos_fallidos', default: 0 })
  intentosFallidos: number;

  @Column({ name: 'comercial_id', type: 'uuid', nullable: true })
  comercialId: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
