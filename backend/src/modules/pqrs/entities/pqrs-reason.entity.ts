import { Column, Entity, PrimaryColumn } from 'typeorm';
import { PqrsConcept } from '../../../common/enums/pqrs-concept.enum';

/**
 * Catálogo de motivos de devolución PQRS (Spec §6): G01–G40 (Garantía)
 * y N01–N18 (Garantía No Aplica). Se siembra en I0.
 */
@Entity('pqrs_reasons')
export class PqrsReason {
  @PrimaryColumn({ length: 4 })
  codigo: string;

  @Column({ type: 'enum', enum: PqrsConcept, enumName: 'pqrs_concept_enum' })
  concepto: PqrsConcept;

  @Column({ length: 150 })
  descripcion: string;
}
