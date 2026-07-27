import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  OcrDocument,
  OcrDocumentStatus,
  OcrEngine,
} from './entities/ocr-document.entity';
import { OcrProviderStatus } from './entities/ocr-provider.entity';
import { OcrProvidersService } from './ocr-providers.service';
import { decryptSecret } from '../../common/crypto/secret-crypto';
import { OcrLocalStrategy } from './strategies/ocr-local.strategy';
import { OcrLlmStrategy } from './strategies/ocr-llm.strategy';
import { OcrStrategy } from './strategies/ocr-strategy.interface';
import { DocumentsService, UploadedFilePayload } from '../documents/documents.service';
import { DocumentType, PERMANENT_DOCUMENT_TYPES } from '../../common/enums/document-type.enum';
import { ParamsService } from '../params/params.service';
import { PARAM_KEYS } from '../params/entities/system-param.entity';
import { AuditService } from '../audit/audit.service';

const TABLA = 'ocr_documents';
const TIPOS_PROCESABLES = [
  DocumentType.FACTURA_IMPORTACION,
  DocumentType.ORDEN_PEDIDO,
  DocumentType.COTIZACION,
  DocumentType.FACTURA_VENTA,
  DocumentType.GUIA_TRANSPORTE,
];

/**
 * HU-021 / CU-009 / M13: procesamiento documental OCR.
 * La selección del motor se centraliza aquí (OCRStrategy): lee el parámetro
 * del sistema `ocr.active_engine` y delega en la estrategia correspondiente,
 * sin cambio de código para cambiar de motor (regla transversal).
 */
@Injectable()
export class OcrService {
  constructor(
    @InjectRepository(OcrDocument)
    private readonly ocrDocs: Repository<OcrDocument>,
    private readonly providers: OcrProvidersService,
    private readonly localStrategy: OcrLocalStrategy,
    private readonly llmStrategy: OcrLlmStrategy,
    private readonly documents: DocumentsService,
    private readonly params: ParamsService,
    private readonly audit: AuditService,
  ) {}

  /** Motor activo configurado (HU-020). */
  async getActiveEngine(): Promise<OcrEngine> {
    const valor = await this.params.getValor<{ engine: OcrEngine }>(
      PARAM_KEYS.OCR_ACTIVE_ENGINE,
    );
    return valor?.engine === OcrEngine.OCR_LLM ? OcrEngine.OCR_LLM : OcrEngine.OCR_LOCAL;
  }

  /**
   * HU-020: selección del motor activo (solo Administrador, auditada).
   * Precondición: para OCR_LLM debe existir un proveedor activo (M13).
   */
  async setActiveEngine(
    engine: OcrEngine,
    admin: { id: string; username: string },
    motivo?: string,
  ) {
    if (engine !== OcrEngine.OCR_LOCAL && engine !== OcrEngine.OCR_LLM) {
      throw new BadRequestException("engine debe ser 'OCR_LOCAL' u 'OCR_LLM'");
    }
    if (engine === OcrEngine.OCR_LLM) {
      const activo = await this.providers.getActive();
      if (!activo) {
        throw new BadRequestException(
          'No hay un proveedor LLM activo; configure y active uno antes de seleccionar OCR_LLM (HU-019)',
        );
      }
    }
    await this.params.update(
      PARAM_KEYS.OCR_ACTIVE_ENGINE,
      { engine },
      motivo ?? 'Selección de motor OCR activo (HU-020)',
      admin,
      this.audit,
    );
    return { engine };
  }

  /** Estrategia del motor activo con su proveedor (si aplica). */
  private async resolveStrategy(): Promise<{
    strategy: OcrStrategy;
    providerId: string | null;
  }> {
    const engine = await this.getActiveEngine();
    if (engine === OcrEngine.OCR_LOCAL) {
      return { strategy: this.localStrategy, providerId: null };
    }
    const provider = await this.providers.getActive();
    if (!provider) {
      throw new BadRequestException(
        'El motor activo es OCR_LLM pero no hay proveedor activo (M13)',
      );
    }
    // C-4: la clave se descifra solo en memoria, al construir la petición LLM
    const providerConClave = {
      ...provider,
      apiKey: decryptSecret(provider.apiKey),
    };
    return {
      strategy: {
        engine: OcrEngine.OCR_LLM,
        extract: (buffer, mime, tipo) =>
          this.llmStrategy.extract(buffer, mime, tipo, providerConClave),
      },
      providerId: provider.id,
    };
  }

  /**
   * HU-021: procesa un documento con el motor activo y deja el resultado en
   * estado Creado para validación (vista editable antes de guardar).
   */
  async process(
    tipo: DocumentType,
    file: UploadedFilePayload,
    user: { id: string; username: string },
    empresaId?: string,
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    if (!TIPOS_PROCESABLES.includes(tipo)) {
      throw new BadRequestException(
        `tipoDocumento debe ser uno de: ${TIPOS_PROCESABLES.join(', ')}`,
      );
    }
    const { strategy, providerId } = await this.resolveStrategy();
    const extraction = await strategy.extract(file.buffer, file.mimetype, tipo);

    // El documento se almacena: facturas permanentes (soporte de aprobación),
    // el resto temporales (M13)
    const doc = await this.documents.store('ocr', tipo, file, user.id);
    const ocrDoc = await this.ocrDocs.save(
      this.ocrDocs.create({
        documentId: doc.id,
        tipoDocumento: tipo,
        motor: strategy.engine,
        providerId,
        estado: OcrDocumentStatus.CREADO,
        confianza: extraction.confianza,
        datosExtraidos: extraction.datos as any,
        textoCrudo: extraction.textoCrudo,
        empresaId: empresaId ?? null,
        createdBy: user.id,
      }),
    );
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'OCR_PROCESAR',
      tabla: TABLA,
      registroId: ocrDoc.id,
      valorNuevo: {
        tipo,
        motor: strategy.engine,
        archivo: file.originalname,
        items: (extraction.datos.items ?? []).length,
        confianza: extraction.confianza,
      },
    });
    return this.toResponse(ocrDoc);
  }

  /**
   * HU-018: prueba de procesamiento con el motor activo (Administrador).
   * No persiste nada; solo verifica que el motor responde.
   */
  async testProcess(tipo: DocumentType, file: UploadedFilePayload) {
    if (!file) throw new BadRequestException('Archivo de prueba requerido');
    const { strategy, providerId } = await this.resolveStrategy();
    const extraction = await strategy.extract(file.buffer, file.mimetype, tipo);
    return {
      motor: strategy.engine,
      providerId,
      confianza: extraction.confianza,
      datos: extraction.datos,
    };
  }

  /** HU-021: corrección manual de los datos extraídos antes de confirmar. */
  async correct(
    id: string,
    datos: Record<string, any>,
    user: { id: string; username: string },
  ) {
    const ocrDoc = await this.findOne(id);
    if (ocrDoc.estado !== OcrDocumentStatus.CREADO) {
      throw new BadRequestException(
        'Solo se pueden corregir documentos en estado Creado',
      );
    }
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
      throw new BadRequestException('datosExtraidos debe ser un objeto');
    }
    const anterior = ocrDoc.datosExtraidos;
    ocrDoc.datosExtraidos = datos;
    const saved = await this.ocrDocs.save(ocrDoc);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'OCR_CORREGIR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior as any,
      valorNuevo: datos as any,
    });
    return this.toResponse(saved);
  }

  /** HU-021/CU-009: el Generador confirma los datos validados. */
  async confirm(id: string, user: { id: string; username: string }) {
    const ocrDoc = await this.findOne(id);
    if (ocrDoc.estado !== OcrDocumentStatus.CREADO) {
      throw new BadRequestException('El documento ya fue confirmado');
    }
    ocrDoc.estado = OcrDocumentStatus.CONFIRMADO;
    ocrDoc.confirmedAt = new Date();
    const saved = await this.ocrDocs.save(ocrDoc);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'OCR_CONFIRMAR',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { estado: 'CONFIRMADO' },
    });
    return this.toResponse(saved);
  }

  /**
   * M13: documentos temporales (órdenes, cotizaciones, guías) pueden
   * eliminarse una vez confirmada la extracción. Las facturas de
   * importación/venta son permanentes (soporte de aprobación).
   */
  async remove(id: string, user: { id: string; username: string }) {
    const ocrDoc = await this.findOne(id);
    if (PERMANENT_DOCUMENT_TYPES.includes(ocrDoc.tipoDocumento)) {
      throw new BadRequestException(
        `Los documentos ${ocrDoc.tipoDocumento} son permanentes (soporte de aprobación) y no se eliminan (M13)`,
      );
    }
    if (ocrDoc.estado !== OcrDocumentStatus.CONFIRMADO) {
      throw new BadRequestException(
        'Un documento temporal solo puede eliminarse una vez confirmada la extracción (M13)',
      );
    }
    const doc = ocrDoc.document;
    await this.ocrDocs.remove(ocrDoc);
    await this.documents.removeFile(doc);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'OCR_ELIMINAR_TEMPORAL',
      tabla: TABLA,
      registroId: id,
      valorAnterior: {
        tipo: ocrDoc.tipoDocumento,
        archivo: doc.nombreOriginal,
      },
    });
    return { eliminado: true };
  }

  async findAll(estado?: OcrDocumentStatus) {
    const where = estado ? { estado } : {};
    const docs = await this.ocrDocs.find({
      where,
      relations: { document: true },
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return docs.map((d) => this.toResponse(d, false));
  }

  async findOne(id: string): Promise<OcrDocument> {
    const ocrDoc = await this.ocrDocs.findOne({
      where: { id },
      relations: { document: true },
    });
    if (!ocrDoc) throw new NotFoundException('Documento OCR no encontrado');
    return ocrDoc;
  }

  async getDetalle(id: string) {
    return this.toResponse(await this.findOne(id));
  }

  private toResponse(d: OcrDocument, conTexto = true) {
    const { textoCrudo, ...rest } = d as any;
    return conTexto ? { ...rest, textoCrudo } : rest;
  }
}
