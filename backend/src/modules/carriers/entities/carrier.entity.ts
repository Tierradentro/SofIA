import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CarrierType } from '../../../common/enums/carrier-type.enum';

/**
 * Transportadora (HU-008, EP-02). Las de tipo INTERNA no exigen guía
 * externa al registrar la salida (M09 paso 5, HU-040).
 */
@Entity('carriers')
export class Carrier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 150 })
  nombre: string;

  @Column({ type: 'enum', enum: CarrierType, enumName: 'carrier_type_enum' })
  tipo: CarrierType;

  @Column({ length: 60, nullable: true })
  identificacion: string;

  @Column({ length: 120, nullable: true })
  telefonos: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
