import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Dirección de despacho del cliente (QA Func. 4.1). Un cliente puede tener
 * hasta 10 direcciones; una de ellas es la principal (la que migra desde
 * clients.direccion histórica). El Pedido selecciona a cuál va el despacho
 * y el Despacho puede ajustarla antes de salir.
 */
@Entity('client_addresses')
@Index(['clientId'])
export class ClientAddress {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'client_id', type: 'uuid' })
  clientId: string;

  @Column({ length: 250 })
  direccion: string;

  @Column({ length: 120, nullable: true })
  ciudad: string | null;

  @Column({ name: 'es_principal', default: false })
  esPrincipal: boolean;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
