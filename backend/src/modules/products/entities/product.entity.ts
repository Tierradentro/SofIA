import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Company } from '../../companies/entities/company.entity';
import { ProductStatus } from '../../../common/enums/product-status.enum';

/**
 * Producto (M05). POR EMPRESA: las existencias nunca se mezclan (regla
 * transversal); UNIQUE(empresa_id, codigo).
 *
 * Índices (regla transversal / Spec §8):
 *  - B-tree: codigo, codigo_oe, ref_cruzada_1, ref_cruzada_2
 *  - pg_trgm GIN: descripcion (criterio de búsqueda predominante)
 *
 * cantidad y cantidad_bloqueada son el SALDO actual: solo cambian por
 * movimientos de inventario (D-01), nunca por edición directa.
 * CHECK: cantidad_bloqueada <= cantidad (definido en la migración).
 */
@Entity('products')
@Index(['empresaId', 'codigo'], { unique: true })
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'empresa_id', type: 'uuid' })
  @Index()
  empresaId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'empresa_id' })
  empresa: Company;

  @Column({ length: 60 })
  @Index()
  codigo: string;

  @Column({ length: 250 })
  descripcion: string;

  @Column({ length: 150, nullable: true })
  proveedor: string;

  @Column({ length: 120, nullable: true })
  marca: string;

  @Column({ length: 120, nullable: true })
  vehiculo: string;

  @Column({ length: 120, nullable: true })
  categoria: string;

  @Column({ length: 120, nullable: true })
  subcategoria: string;

  @Column({ type: 'text', nullable: true })
  observaciones: string;

  @Column({ length: 250, nullable: true })
  aplicacion: string;

  @Column({ name: 'codigo_oe', length: 60, nullable: true })
  @Index()
  codigoOE: string;

  @Column({ name: 'ref_cruzada_1', length: 60, nullable: true })
  @Index()
  refCruzada1: string;

  @Column({ name: 'ref_cruzada_2', length: 60, nullable: true })
  @Index()
  refCruzada2: string;

  @Column({ name: 'unidad_medida', length: 30, nullable: true })
  unidadMedida: string;

  /** Saldo actual — solo lo cambian los movimientos (D-01). */
  @Column({ default: 0 })
  cantidad: number;

  @Column({ name: 'cantidad_bloqueada', default: 0 })
  cantidadBloqueada: number;

  @Column({ type: 'numeric', precision: 14, scale: 2, default: 0 })
  precio: number;

  @Column({
    type: 'enum',
    enum: ProductStatus,
    enumName: 'product_status_enum',
    default: ProductStatus.ACTIVO,
  })
  estado: ProductStatus;

  @Column({ name: 'link_imagen', length: 500, nullable: true })
  linkImagen: string;

  /** Ubicación en bodega como texto (MVP); el modelo 2D/3D llega en Fase 2 (D-15). */
  @Column({ length: 120, nullable: true })
  ubicacion: string;

  /** Grupos del maestro contable, mapeados a ubicación en Fase 2 (M16). */
  @Column({ name: 'grupo_siete', length: 60, nullable: true })
  grupoSiete: string;

  @Column({ name: 'grupo_ocho', length: 60, nullable: true })
  grupoOcho: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
