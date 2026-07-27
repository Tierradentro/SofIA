import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { execFile } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { DocumentType } from '../../../common/enums/document-type.enum';
import { OcrFieldParser } from '../ocr-field-parser';
import { OcrEngine } from '../entities/ocr-document.entity';
import { OcrExtractionResult, OcrStrategy } from './ocr-strategy.interface';

const execFileAsync = promisify(execFile);

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'image/bmp', 'image/webp'];

/**
 * HU-018: OCR local embebido (Tesseract + Poppler), sin dependencia de
 * proveedores externos. Opción de contingencia (M13).
 * - Imágenes: tesseract directo (TSV para confianza promedio).
 * - PDF: pdftotext (texto embebido); si está vacío, pdftoppm + tesseract.
 */
@Injectable()
export class OcrLocalStrategy implements OcrStrategy {
  readonly engine = OcrEngine.OCR_LOCAL;
  private readonly logger = new Logger(OcrLocalStrategy.name);
  private readonly parser = new OcrFieldParser();

  async extract(
    buffer: Buffer,
    mime: string,
    tipo: DocumentType,
  ): Promise<OcrExtractionResult> {
    // Spec §8: si hay ocr-worker configurado, delegar el procesamiento pesado;
    // el motor embebido queda como contingencia si el worker no responde.
    const workerUrl = process.env.OCR_WORKER_URL;
    if (workerUrl) {
      try {
        return await this.extractViaWorker(workerUrl, buffer, mime, tipo);
      } catch (e: any) {
        this.logger.warn(
          `ocr-worker no disponible (${e.message}); usando OCR local embebido`,
        );
      }
    }
    return this.extractEmbedded(buffer, mime, tipo);
  }

  /** Delegación al servicio OCR independiente (HTTP). */
  private async extractViaWorker(
    workerUrl: string,
    buffer: Buffer,
    mime: string,
    tipo: DocumentType,
  ): Promise<OcrExtractionResult> {
    const res = await fetch(`${workerUrl}/extract`, {
      method: 'POST',
      headers: { 'Content-Type': mime },
      body: new Uint8Array(buffer),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) {
      throw new Error(`worker HTTP ${res.status}`);
    }
    const r: any = await res.json();
    if (!r.texto || !r.texto.trim()) {
      throw new BadRequestException(
        'No se pudo extraer texto del documento (OCR local con baja confianza); ' +
          'cargue los datos manualmente o cambie el motor OCR',
      );
    }
    return {
      datos: this.parser.parse(r.texto, tipo),
      textoCrudo: r.texto,
      confianza: r.confianza ?? null,
    };
  }

  /** OCR local embebido (ejecución dentro del backend, HU-018). */
  private async extractEmbedded(
    buffer: Buffer,
    mime: string,
    tipo: DocumentType,
  ): Promise<OcrExtractionResult> {
    let texto = '';
    let confianza: number | null = null;

    if (mime === 'application/pdf') {
      const r = await this.extractPdf(buffer);
      texto = r.texto;
      confianza = r.confianza;
    } else if (IMAGE_MIMES.includes(mime)) {
      const r = await this.extractImage(buffer, mime);
      texto = r.texto;
      confianza = r.confianza;
    } else {
      throw new BadRequestException(
        `Tipo de archivo no soportado para OCR local: ${mime}. Use PDF o imagen.`,
      );
    }

    if (!texto.trim()) {
      throw new BadRequestException(
        'No se pudo extraer texto del documento (OCR local con baja confianza); ' +
          'cargue los datos manualmente o cambie el motor OCR',
      );
    }

    return {
      datos: this.parser.parse(texto, tipo),
      textoCrudo: texto,
      confianza,
    };
  }

  private async extractImage(
    buffer: Buffer,
    mime: string,
  ): Promise<{ texto: string; confianza: number | null }> {
    const dir = mkdtempSync(join(tmpdir(), 'sofia-ocr-'));
    const ext = mime === 'image/png' ? '.png' : '.img';
    const input = join(dir, `input${ext}`);
    writeFileSync(input, buffer);
    const outBase = join(dir, 'out');
    try {
      // Idiomas configurables (Docker: spa+eng; desarrollo: eng)
      const langs = process.env.OCR_TESS_LANGS || 'eng';
      await execFileAsync(
        'tesseract',
        [input, outBase, '-l', langs, '--psm', '6', 'tsv'],
        { timeout: 120000 },
      );
      const tsvPath = `${outBase}.tsv`;
      const tsv = readFileSync(tsvPath, 'utf8');
      return { texto: this.tsvToText(tsv), confianza: this.tsvConfidence(tsv) };
    } catch (e: any) {
      this.logger.warn(`tesseract falló: ${e.message}`);
      throw new BadRequestException(
        'El motor OCR local no pudo procesar la imagen (verifique que Tesseract esté instalado)',
      );
    }
  }

  private async extractPdf(
    buffer: Buffer,
  ): Promise<{ texto: string; confianza: number | null }> {
    const dir = mkdtempSync(join(tmpdir(), 'sofia-ocr-pdf-'));
    const input = join(dir, 'input.pdf');
    writeFileSync(input, buffer);

    // 1) Texto embebido
    try {
      const { stdout } = await execFileAsync(
        'pdftotext',
        ['-layout', input, '-'],
        { timeout: 60000 },
      );
      if (stdout.trim().length >= 10) {
        return { texto: stdout, confianza: null };
      }
    } catch (e: any) {
      this.logger.warn(`pdftotext falló: ${e.message}`);
    }

    // 2) PDF escaneado: rasterizar (máx. 3 páginas) + tesseract
    try {
      await execFileAsync(
        'pdftoppm',
        ['-png', '-r', '200', '-f', '1', '-l', '3', input, join(dir, 'page')],
        { timeout: 120000 },
      );
      const paginas = readdirSync(dir)
        .filter((f) => f.startsWith('page') && f.endsWith('.png'))
        .sort();
      let texto = '';
      let confs: number[] = [];
      for (const p of paginas) {
        const r = await this.extractImage(readFileSync(join(dir, p)), 'image/png');
        texto += r.texto + '\n';
        if (r.confianza !== null) confs.push(r.confianza);
      }
      const confianza = confs.length
        ? confs.reduce((a, b) => a + b, 0) / confs.length
        : null;
      return { texto, confianza };
    } catch (e: any) {
      this.logger.warn(`pdftoppm falló: ${e.message}`);
      return { texto: '', confianza: null };
    }
  }

  /** Reconstruye líneas de texto desde el TSV de tesseract. */
  private tsvToText(tsv: string): string {
    const lineas: string[] = [];
    let actual: string[] = [];
    let lastLine = -1;
    for (const row of tsv.split('\n').slice(1)) {
      const cols = row.split('\t');
      if (cols.length < 12 || !cols[11] || !cols[11].trim()) continue;
      const lineNum = parseInt(cols[4], 10);
      if (lastLine !== -1 && lineNum !== lastLine) {
        lineas.push(actual.join(' '));
        actual = [];
      }
      actual.push(cols[11].trim());
      lastLine = lineNum;
    }
    if (actual.length) lineas.push(actual.join(' '));
    return lineas.join('\n');
  }

  /** Confianza promedio (0..1) de las palabras reconocidas. */
  private tsvConfidence(tsv: string): number | null {
    const confs: number[] = [];
    for (const row of tsv.split('\n').slice(1)) {
      const cols = row.split('\t');
      if (cols.length < 12 || !cols[11] || !cols[11].trim()) continue;
      const c = parseFloat(cols[10]);
      if (!isNaN(c) && c >= 0) confs.push(c);
    }
    if (!confs.length) return null;
    const avg = confs.reduce((a, b) => a + b, 0) / confs.length;
    return Math.round((avg / 100) * 1000) / 1000;
  }
}
