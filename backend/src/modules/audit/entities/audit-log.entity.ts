import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Log de auditoría (Spec M15). Tabla APPEND-ONLY:
 * un trigger BEFORE UPDATE OR DELETE en BD bloquea cualquier modificación
 * (la purga administrativa usa SET LOCAL audit.allow_purge='on' dentro de
 * una transacción controlada, con exportación previa y auto-auditoría).
 */
@Entity('audit_logs')
@Index(['tabla', 'registroId'])
@Index(['usuarioId'])
@Index(['fechaHora'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'usuario_id', type: 'uuid', nullable: true })
  usuarioId: string | null;

  @Column({ name: 'usuario_username', length: 60, nullable: true })
  usuarioUsername: string | null;

  @CreateDateColumn({ name: 'fecha_hora', type: 'timestamptz' })
  fechaHora: Date;

  /** Acción realizada: CREAR, EDITAR, LOGIN, LOGIN_FALLIDO, CORRECCION, PURGA, ... */
  @Column({ length: 60 })
  accion: string;

  /** Tabla afectada (Clientes, Productos, Inventarios, Pedidos, Despachos, Casos PQRS, users, ...) */
  @Column({ length: 60 })
  tabla: string;

  @Column({ name: 'registro_id', length: 80, nullable: true })
  registroId: string | null;

  @Column({ name: 'valor_anterior', type: 'jsonb', nullable: true })
  valorAnterior: Record<string, any> | null;

  @Column({ name: 'valor_nuevo', type: 'jsonb', nullable: true })
  valorNuevo: Record<string, any> | null;

  /** Motivo obligatorio para correcciones administrativas y purgas. */
  @Column({ type: 'text', nullable: true })
  motivo: string | null;
}
