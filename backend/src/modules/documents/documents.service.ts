import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createWriteStream, mkdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { randomUUID } from 'crypto';
import { Document } from './entities/document.entity';
import {
  DocumentType,
  PERMANENT_DOCUMENT_TYPES,
} from '../../common/enums/document-type.enum';
import { AuditService } from '../audit/audit.service';

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface UploadedFilePayload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    private readonly audit: AuditService,
  ) {}

  private filesDir(): string {
    return process.env.FILES_DIR || '/tmp/sofia-files';
  }

  /** HU-006: carga del logo empresarial con validación de formato de imagen. */
  async uploadLogo(file: UploadedFilePayload, admin: { id: string; username: string }) {
    if (!file) throw new BadRequestException('Archivo requerido');
    if (!IMAGE_MIMES.includes(file.mimetype)) {
      throw new BadRequestException(
        'Formato no válido: el logo debe ser una imagen PNG o JPG',
      );
    }
    if (file.size > MAX_IMAGE_BYTES) {
      throw new BadRequestException('El logo no puede superar 5 MB');
    }

    // Reemplaza el logo anterior (solo uno activo)
    const anteriores = await this.documents.find({
      where: { ownerType: 'system', tipo: DocumentType.LOGO },
    });
    for (const doc of anteriores) {
      unlinkSync(join(this.filesDir(), doc.path));
      await this.documents.remove(doc);
    }

    const dir = join(this.filesDir(), 'system');
    mkdirSync(dir, { recursive: true });
    const relPath = join('system', `logo${extname(file.originalname).toLowerCase()}`);
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(join(this.filesDir(), relPath));
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      stream.end(file.buffer);
    });

    const saved = await this.documents.save(
      this.documents.create({
        ownerType: 'system',
        ownerId: null,
        tipo: DocumentType.LOGO,
        path: relPath,
        nombreOriginal: file.originalname,
        mime: file.mimetype,
        size: file.size,
        esTemporal: false,
        createdBy: admin.id,
      }),
    );
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CONFIGURAR_LOGO',
      tabla: 'documents',
      registroId: saved.id,
      valorAnterior: anteriores.length
        ? { path: anteriores[0].path, nombreOriginal: anteriores[0].nombreOriginal }
        : null,
      valorNuevo: { path: saved.path, nombreOriginal: saved.nombreOriginal },
    });
    return saved;
  }

  /**
   * Almacena un archivo genérico en el volumen (M13/D-07).
   * ownerType identifica la entidad dueña; esTemporal según el tipo.
   */
  async store(
    ownerType: string,
    tipo: DocumentType,
    file: UploadedFilePayload,
    userId: string,
  ): Promise<Document> {
    if (!file) throw new BadRequestException('Archivo requerido');
    const dir = join(this.filesDir(), ownerType);
    mkdirSync(dir, { recursive: true });
    const relPath = join(
      ownerType,
      `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
    );
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(join(this.filesDir(), relPath));
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      stream.end(file.buffer);
    });
    return this.documents.save(
      this.documents.create({
        ownerType,
        ownerId: null,
        tipo,
        path: relPath,
        nombreOriginal: file.originalname,
        mime: file.mimetype,
        size: file.size,
        esTemporal: !PERMANENT_DOCUMENT_TYPES.includes(tipo),
        createdBy: userId,
      }),
    );
  }

  absolutePath(doc: Document): string {
    return join(this.filesDir(), doc.path);
  }

  async removeFile(doc: Document): Promise<void> {
    try {
      unlinkSync(join(this.filesDir(), doc.path));
    } catch {
      // El archivo puede no existir; la fila se elimina igual
    }
    await this.documents.remove(doc);
  }

  async getLogo(): Promise<{ doc: Document; absolutePath: string } | null> {
    const doc = await this.documents.findOne({
      where: { ownerType: 'system', tipo: DocumentType.LOGO },
      order: { createdAt: 'DESC' },
    });
    if (!doc) return null;
    return { doc, absolutePath: join(this.filesDir(), doc.path) };
  }

  /**
   * HU-007 / I25: genera la página de etiqueta 50×30 mm. El sistema envía la
   * etiqueta al diálogo de impresión del navegador con ese formato; la
   * impresora (XPrinter XP-58) se selecciona en el sistema operativo.
   * La etiqueta lleva el código de barras CODE-128 de la caja, el nombre de
   * la empresa (o ambas si el envío es mixto), el código de la caja y el
   * número del despacho.
   */
  buildLabelHtml(
    boxCode: string,
    barcodeDataUrl: string,
    despachoNumero?: string,
    empresas?: string,
  ): string {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Etiqueta ${boxCode}</title>
<style>
  @page { size: 50mm 30mm; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 50mm; height: 30mm; }
  .etiqueta {
    width: 50mm; height: 30mm; padding: 1mm 2mm;
    display: flex; flex-direction: column; align-items: center;
    justify-content: space-between;
    font-family: Arial, sans-serif; text-align: center;
  }
  .empresa {
    font-size: 6pt; font-weight: bold; text-transform: uppercase;
    max-width: 46mm; white-space: nowrap; overflow: hidden;
    text-overflow: ellipsis;
  }
  .etiqueta img { width: 40mm; height: 11mm; object-fit: fill; }
  .codigo { font-size: 7pt; font-weight: bold; letter-spacing: 0.5pt; }
  .despacho { font-size: 5.5pt; color: #333; }
</style>
</head>
<body onload="window.print()">
  <div class="etiqueta">
    ${empresas ? `<div class="empresa">${empresas}</div>` : ''}
    <img src="${barcodeDataUrl}" alt="Código de barras">
    <div class="codigo">${boxCode}</div>
    ${despachoNumero ? `<div class="despacho">Despacho ${despachoNumero}</div>` : ''}
  </div>
</body>
</html>`;
  }
}
