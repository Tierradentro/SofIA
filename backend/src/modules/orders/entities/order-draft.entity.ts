import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * I67: borrador de pedido en digitación. Si la aplicación se desconecta o
 * se va la luz mientras el operario digita, el trabajo NO se pierde: el
 * frontend guarda el contenido del formulario aquí cada pocos segundos y lo
 * recupera al volver a entrar a «Nuevo pedido».
 *
 * El borrador NO es un pedido: no tiene número (el consecutivo SIGLAS-####
 * se asigna recién al confirmar), no bloquea existencias, no aparece en
 * listados, colas, exportaciones ni conteos. Es un área de trabajo temporal
 * por usuario; al confirmarse se crea el pedido real (misma validación de
 * siempre) y el borrador se elimina.
 *
 * `payload` guarda el formulario tal cual (cliente, comercial, ciudad,
 * dirección, notas, vía, documento OCR e ítems digitados), por eso es jsonb:
 * el borrador admite datos parciales que aún no pasarían la validación de
 * creación (p. ej. ítems sin referencia resuelta o sin cliente elegido).
 */
@Entity('order_drafts')
@Index(['userId'])
export class OrderDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** El borrador es personal: solo su creador lo ve, lo edita y lo confirma. */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** Empresa para la que se digita el pedido (puede faltar al inicio). */
  @Column({ name: 'empresa_id', type: 'uuid', nullable: true })
  empresaId: string | null;

  /** Contenido del formulario tal cual lo digitó el usuario. */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
