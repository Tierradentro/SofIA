import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * API key (M17). Se asocia a un usuario con rol API (M14).
 * Solo se almacena el hash (SHA-256) y un prefijo para enmascarar;
 * la clave completa se muestra una única vez al crearla.
 */
@Entity('api_keys')
export class ApiKey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ length: 120 })
  nombre: string;

  @Column({ name: 'key_hash', unique: true, length: 64 })
  keyHash: string;

  /** Primeros 8 caracteres de la clave, para mostrar enmascarada (sk_xxxx…). */
  @Column({ name: 'key_prefix', length: 12 })
  keyPrefix: string;

  @Column({ default: true })
  activo: boolean;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
