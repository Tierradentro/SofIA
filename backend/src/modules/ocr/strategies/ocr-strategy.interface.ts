import { DocumentType } from '../../../common/enums/document-type.enum';
import { OcrExtractedData } from '../ocr-field-parser';
import { OcrEngine } from '../entities/ocr-document.entity';

/** Resultado crudo de una estrategia OCR antes de persistir. */
export interface OcrExtractionResult {
  datos: OcrExtractedData;
  textoCrudo: string | null;
  confianza: number | null;
}

/**
 * Regla transversal (spec §Reglas): la selección de OCR se centraliza en
 * OcrStrategy con implementaciones OCR_LOCAL y OCR_LLM; un motor activo a
 * la vez, seleccionado por parámetro del sistema sin cambiar código.
 */
export interface OcrStrategy {
  readonly engine: OcrEngine;
  extract(
    buffer: Buffer,
    mime: string,
    tipo: DocumentType,
  ): Promise<OcrExtractionResult>;
}

export const OCR_STRATEGIES = 'OCR_STRATEGIES';
