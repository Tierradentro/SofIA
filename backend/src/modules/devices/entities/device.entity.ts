import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** I57: estados del ciclo de vida de un dispositivo (navegador autorizado). */
export enum DeviceEstado {
  PENDIENTE = 'PENDIENTE',
  APROBADO = 'APROBADO',
  RECHAZADO = 'RECHAZADO',
  REVOCADO = 'REVOCADO',
}

/**
 * I57: dispositivo (navegador) registrado para acceder a la aplicación.
 * La autorización es por dispositivo, no por usuario: una vez aprobado,
 * cualquier usuario puede ingresar desde ese navegador. El navegador se
 * identifica con un UUID generado por el frontend y conservado en
 * localStorage (header X-Device-Id); el token JWT queda ligado a él.
 */
@Entity('devices')
export class Device {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Huella del navegador (UUID generado en el cliente). */
  @Index({ unique: true })
  @Column({ name: 'device_id', length: 64 })
  deviceId: string;

  /** Nombre legible, p. ej. «Chrome 126 · Windows 10». */
  @Column({ length: 160 })
  nombre: string;

  @Column({ name: 'user_agent', type: 'text' })
  userAgent: string;

  @Column({ length: 40, nullable: true })
  idioma: string | null;

  @Column({ length: 80, nullable: true })
  plataforma: string | null;

  @Column({ length: 20, nullable: true })
  resolucion: string | null;

  /** Última IP observada en el login. */
  @Column({ length: 60, nullable: true })
  ip: string | null;

  @Column({ type: 'varchar', length: 12, default: DeviceEstado.PENDIENTE })
  estado: DeviceEstado;

  /** Usuario que ingresó primero desde este navegador. */
  @Column({ name: 'registrado_por_id', type: 'uuid', nullable: true })
  registradoPorId: string | null;

  @Column({ name: 'registrado_por_nombre', length: 160, nullable: true })
  registradoPorNombre: string | null;

  @Column({ name: 'aprobado_at', type: 'timestamptz', nullable: true })
  aprobadoAt: Date | null;

  @Column({ name: 'aprobado_por_id', type: 'uuid', nullable: true })
  aprobadoPorId: string | null;

  @Column({ name: 'aprobado_por_nombre', length: 160, nullable: true })
  aprobadoPorNombre: string | null;

  @Column({ name: 'rechazado_at', type: 'timestamptz', nullable: true })
  rechazadoAt: Date | null;

  @Column({ name: 'rechazado_por_id', type: 'uuid', nullable: true })
  rechazadoPorId: string | null;

  @Column({ name: 'rechazado_por_nombre', length: 160, nullable: true })
  rechazadoPorNombre: string | null;

  @Column({ name: 'revocado_at', type: 'timestamptz', nullable: true })
  revocadoAt: Date | null;

  @Column({ name: 'revocado_por_id', type: 'uuid', nullable: true })
  revocadoPorId: string | null;

  @Column({ name: 'revocado_por_nombre', length: 160, nullable: true })
  revocadoPorNombre: string | null;

  @Column({ name: 'ultimo_uso_at', type: 'timestamptz', nullable: true })
  ultimoUsoAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
