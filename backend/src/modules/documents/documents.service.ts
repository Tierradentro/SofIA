import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createWriteStream, mkdirSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { randomUUID } from 'crypto';
import { Document } from './entities/document.entity';
import {
  DocumentType,
  PERMANENT_DOCUMENT_TYPES,
} from '../../common/enums/document-type.enum';
import { AuditService } from '../audit/audit.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Seguridad (auditoría #3): lista blanca de imágenes verificada por MAGIC
 * BYTES, nunca por el Content-Type que declara quien sube. Un SVG con
 * <script> servido desde el origen de la app roba el token de localStorage
 * (XSS). Solo se aceptan PNG, JPEG y WEBP reales.
 */
export function mimeImagenSegura(buffer: Buffer): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (!buffer || buffer.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e &&
    buffer[3] === 0x47 && buffer[4] === 0x0d && buffer[5] === 0x0a &&
    buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 &&
    buffer[3] === 0x46 && buffer[8] === 0x57 && buffer[9] === 0x45 &&
    buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** Extensión segura según el tipo verificado por bytes (nunca la del nombre). */
const EXT_POR_MIME: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

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
    // Seguridad: se verifica el contenido por magic bytes, no el MIME declarado
    const verificado = mimeImagenSegura(file.buffer);
    if (!verificado || verificado === 'image/webp') {
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
    const relPath = join('system', `logo${EXT_POR_MIME[verificado]}`);
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
        mime: verificado,
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
    // Seguridad (auditoría #3): si declara ser imagen, se verifica por magic
    // bytes y el MIME guardado es el verificado, no el declarado. Si no
    // verifica, se rechaza: un SVG/HTML disfrazado ejecutaría scripts en el
    // origen de la aplicación al abrirlo.
    let mime = file.mimetype;
    if (file.mimetype?.startsWith('image/')) {
      const verificado = mimeImagenSegura(file.buffer);
      if (!verificado) {
        throw new BadRequestException(
          'El contenido del archivo no corresponde a una imagen válida (PNG, JPEG o WEBP)',
        );
      }
      mime = verificado;
    }
    const dir = join(this.filesDir(), ownerType);
    mkdirSync(dir, { recursive: true });
    const ext = EXT_POR_MIME[mime] ?? extname(file.originalname).toLowerCase();
    const relPath = join(ownerType, `${randomUUID()}${ext}`);
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
        mime,
        size: file.size,
        esTemporal: !PERMANENT_DOCUMENT_TYPES.includes(tipo),
        createdBy: userId,
      }),
    );
  }

  absolutePath(doc: Document): string {
    return join(this.filesDir(), doc.path);
  }

  /** I41: consulta puntual por id (foto de producto reemplazada/eliminada). */
  async findById(id: string): Promise<Document> {
    const doc = await this.documents.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return doc;
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
   * Seguridad (auditoría #5): los datos de BD se ESCAPAN antes de interpolar
   * (el nombre de empresa lo edita el Administrador) y el data URL del
   * código de barras se valida estrictamente.
   */
  buildLabelHtml(
    boxCode: string,
    barcodeDataUrl: string,
    despachoNumero?: string,
    empresas?: string,
  ): string {
    const box = escapeHtml(boxCode);
    const emp = empresas ? escapeHtml(empresas) : '';
    const dsp = despachoNumero ? escapeHtml(despachoNumero) : '';
    const dataUrl = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(
      barcodeDataUrl ?? '',
    )
      ? barcodeDataUrl
      : '';
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Etiqueta ${box}</title>
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
    ${emp ? `<div class="empresa">${emp}</div>` : ''}
    <img src="${dataUrl}" alt="Código de barras">
    <div class="codigo">${box}</div>
    ${dsp ? `<div class="despacho">Despacho ${dsp}</div>` : ''}
  </div>
</body>
</html>`;
  }
}

/** Escape HTML básico para interpolar texto de BD en la etiqueta (#5). */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
