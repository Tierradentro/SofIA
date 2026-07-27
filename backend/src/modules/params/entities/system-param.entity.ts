import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Parámetros del sistema (Spec M02/M14). Valores JSONB para flexibilidad.
 * Claves sembradas: política de claves, rate limit API, motor OCR activo.
 */
@Entity('system_params')
export class SystemParam {
  @PrimaryColumn({ length: 100 })
  clave: string;

  @Column({ type: 'jsonb' })
  valor: Record<string, any>;

  @Column({ length: 250, nullable: true })
  descripcion: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}

/** Claves conocidas de parámetros. */
export const PARAM_KEYS = {
  PASSWORD_POLICY: 'security.password_policy',
  API_RATE_LIMIT: 'api.rate_limit_per_minute',
  OCR_ACTIVE_ENGINE: 'ocr.active_engine',
} as const;
