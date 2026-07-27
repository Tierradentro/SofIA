import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Product } from './product.entity';
import { BarcodeOrigin } from '../../../common/enums/barcode-origin.enum';

/**
 * Código de barras del producto (D-02, M05):
 *  - ÚNICO a nivel global del sistema (aunque sea de otra empresa).
 *  - Un producto tiene un único código de barras (1:1 enforceado).
 *  - Si al asociar un código ya existe, se bloquea e informa el producto dueño.
 *  - Se registra el origen: escaneado (HU-011) o manual (HU-012).
 */
@Entity('product_barcodes')
export class ProductBarcode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 120 })
  barcode: string;

  @Column({ name: 'product_id', type: 'uuid', unique: true })
  productId: string;

  @OneToOne(() => Product)
  @JoinColumn({ name: 'product_id' })
  product: Product;

  @Column({ type: 'enum', enum: BarcodeOrigin, enumName: 'barcode_origin_enum' })
  origen: BarcodeOrigin;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
