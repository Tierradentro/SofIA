import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DocumentType } from '../../../common/enums/document-type.enum';
import { OcrExtractedData } from '../ocr-field-parser';
import { OcrEngine } from '../entities/ocr-document.entity';
import { OcrProvider, OcrProviderKind } from '../entities/ocr-provider.entity';
import { OcrExtractionResult } from './ocr-strategy.interface';

type FetchFn = typeof fetch;

/** Campos de cabecera con sus alias frecuentes en inglés (I22). */
const ALIAS_CABECERA: Record<string, string[]> = {
  numeroFactura: ['invoice_number', 'invoiceNumber', 'invoice_no', 'invoice', 'factura', 'folio'],
  fecha: ['date', 'invoice_date', 'invoiceDate', 'fechaFactura'],
  proveedor: ['supplier', 'vendor', 'remitente'],
  cliente: ['customer', 'buyer', 'destinatario', 'consignee'],
  nit: ['tax_id', 'taxId', 'vat', 'identificacion', 'nit_cliente', 'customer_nit'],
  telefono: ['phone', 'telephone', 'celular'],
  direccion: ['address', 'direccion_cliente'],
  numeroGuia: ['tracking', 'tracking_number', 'shipment', 'guia'],
  transportadora: ['carrier', 'transportista'],
  total: ['grand_total', 'total_amount', 'totalAmount', 'total_factura', 'totalFactura'],
  observaciones: ['notes', 'remarks', 'observations'],
};

const ALIAS_ITEM: Record<string, string[]> = {
  referencia: ['reference', 'ref', 'sku', 'code', 'codigo', 'item', 'part_number'],
  descripcion: ['description', 'desc', 'detalle'],
  cantidad: ['quantity', 'qty', 'cant'],
  unidad: ['unit', 'unit_of_measure'],
  valorUnitario: ['unit_price', 'unitPrice', 'price', 'precio_unitario', 'valor_unitario'],
  valorTotal: ['line_total', 'lineTotal', 'amount', 'valor_total'],
};

/** Toma el primer alias presente (y no vacío) del objeto. */
function porAlias(obj: any, aliases: string[]): any {
  for (const k of aliases) {
    if (obj?.[k] !== undefined && obj?.[k] !== null && obj?.[k] !== '') return obj[k];
  }
  return undefined;
}

const CAMPOS_JSON = `{
  "numeroFactura": string|null, "fecha": "YYYY-MM-DD"|null,
  "proveedor": string|null, "cliente": string|null,
  "nit": string|null, "telefono": string|null, "direccion": string|null,
  "numeroGuia": string|null, "transportadora": string|null,
  "total": number|null, "observaciones": string|null,
  "items": [{"referencia": string, "descripcion": string|null, "cantidad": number, "unidad": string, "valorUnitario": number|null, "valorTotal": number|null}]
}`;

/** QA Func. 2.5: instrucción específica por tipo de documento. */
function instruccionPorTipo(tipo: DocumentType): string {
  switch (tipo) {
    case DocumentType.ORDEN_PEDIDO:
    case DocumentType.COTIZACION:
      return (
        'Es un documento de VENTA: extrae cliente, nit (identificación tributaria), ' +
        'dirección, teléfono y, por cada ítem, el valorUnitario y valorTotal. ' +
        'proveedor/numeroGuia/transportadora normalmente no aplican (usa null).'
      );
    case DocumentType.FACTURA_VENTA:
      return (
        'Es una factura de VENTA: extrae cliente, nit, dirección, teléfono, el total ' +
        'de la factura y, por cada ítem, valorUnitario y valorTotal.'
      );
    case DocumentType.FACTURA_IMPORTACION:
      return (
        'Es una factura de IMPORTACIÓN (compra): extrae proveedor, numeroGuia y ' +
        'transportadora; los ítems no llevan valor (usa null en valorUnitario/valorTotal).'
      );
    case DocumentType.GUIA_TRANSPORTE:
      return (
        'Es una guía de transporte: lo esencial es numeroGuia, transportadora, ' +
        'destinatario (cliente) y dirección.'
      );
    default:
      return 'Extrae los campos que aparezcan; usa null en los que no apliquen.';
  }
}

/**
 * HU-019: OCR basado en LLM (OpenAI, Gemini, OpenRouter).
 * Envía el documento (imagen/PDF en base64) con un prompt de extracción
 * estructurada y parsea el JSON de respuesta. El `fetchFn` es inyectable
 * para pruebas. No implementa OcrStrategy directamente: requiere el
 * proveedor activo, con el que OcrService la envuelve como estrategia.
 */
@Injectable()
export class OcrLlmStrategy {
  readonly engine = OcrEngine.OCR_LLM;
  private readonly logger = new Logger(OcrLlmStrategy.name);

  /**
   * Función de red inyectable para pruebas (no es dependencia NestJS;
   * se asigna como propiedad, no por constructor). Si no se define,
   * se usa el fetch global vigente al momento de la llamada.
   */
  fetchFn?: FetchFn;

  private get fetch_(): FetchFn {
    return this.fetchFn ?? globalThis.fetch;
  }

  async extract(
    buffer: Buffer,
    mime: string,
    tipo: DocumentType,
    provider: OcrProvider,
  ): Promise<OcrExtractionResult> {
    // I22: algunos modelos responden mejor cuando el esquema se lista
    // campo por campo con sus nombres exactos, no como firma TypeScript
    const prompt =
      `Eres un extractor de datos de documentos logísticos (${tipo}). ` +
      instruccionPorTipo(tipo) +
      ` Responde ÚNICAMENTE con JSON válido, sin markdown, sin texto adicional, ` +
      `usando EXACTAMENTE estos nombres de campo (en español, con mayúsculas y minúsculas como se indican):\n` +
      `- Cabecera: numeroFactura, fecha (formato YYYY-MM-DD), proveedor, cliente, nit, telefono, ` +
      `direccion, numeroGuia, transportadora, total (número), observaciones.\n` +
      `- items: lista de objetos con referencia, descripcion, cantidad (entero), unidad ("UND" por defecto), ` +
      `valorUnitario (número) y valorTotal (número).\n` +
      `Si un campo no aparece en el documento usa null. Ejemplo de forma: ${CAMPOS_JSON}.`;
    const base64 = buffer.toString('base64');

    let contenido: string;
    try {
      contenido = await this.callProvider(provider, prompt, base64, mime);
    } catch (e: any) {
      this.logger.warn(`Proveedor LLM ${provider.proveedor} falló: ${e.message}`);
      // CU-009 (falla LLM): error explícito para que el admin cambie a OCR local
      throw new ServiceUnavailableException(
        `El proveedor LLM (${provider.nombre}) no respondió: ${e.message}. ` +
          'Puede cambiar el motor activo a OCR_LOCAL como contingencia.',
      );
    }

    const datos = this.parseJson(contenido);
    return { datos, textoCrudo: contenido, confianza: null };
  }

  private async callProvider(
    provider: OcrProvider,
    prompt: string,
    base64: string,
    mime: string,
  ): Promise<string> {
    if (provider.proveedor === OcrProviderKind.GEMINI) {
      return this.callGemini(provider, prompt, base64, mime);
    }
    return this.callOpenAiCompatible(provider, prompt, base64, mime);
  }

  /** OpenAI y OpenRouter comparten la API de chat completions. */
  private async callOpenAiCompatible(
    provider: OcrProvider,
    prompt: string,
    base64: string,
    mime: string,
  ): Promise<string> {
    const url =
      provider.proveedor === OcrProviderKind.OPENROUTER
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
    const content: any[] = [{ type: 'text', text: prompt }];
    if (mime.startsWith('image/')) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${mime};base64,${base64}` },
      });
    } else {
      content.push({
        type: 'text',
        text: `Documento (base64, ${mime}): ${base64.slice(0, 200000)}`,
      });
    }
    const res = await this.fetch_(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.modelo,
        messages: [{ role: 'user', content }],
        temperature: 0,
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body: any = await res.json();
    const texto: string | undefined = body?.choices?.[0]?.message?.content;
    if (!texto) throw new Error('respuesta sin contenido');
    return texto;
  }

  private async callGemini(
    provider: OcrProvider,
    prompt: string,
    base64: string,
    mime: string,
  ): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.modelo}:generateContent`;
    const parts: any[] = [{ text: prompt }];
    if (mime.startsWith('image/') || mime === 'application/pdf') {
      parts.push({ inline_data: { mime_type: mime, data: base64 } });
    }
    const res = await this.fetch_(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': provider.apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0 },
      }),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    const body: any = await res.json();
    const texto: string | undefined =
      body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new Error('respuesta sin contenido');
    return texto;
  }

  /** Parsea el JSON del LLM tolerando fences ```json y texto adicional. */
  private parseJson(contenido: string): OcrExtractedData {
    let limpio = contenido.trim();
    limpio = limpio.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    const inicio = limpio.indexOf('{');
    const fin = limpio.lastIndexOf('}');
    if (inicio === -1 || fin === -1) {
      throw new BadRequestException(
        'El proveedor LLM no devolvió JSON válido; corrija manualmente o reintente',
      );
    }
    let raw: any;
    try {
      raw = JSON.parse(limpio.slice(inicio, fin + 1));
    } catch {
      throw new BadRequestException(
        'El proveedor LLM no devolvió JSON válido; corrija manualmente o reintente',
      );
    }
    const items = Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.line_items) // I22: alias frecuente en inglés
        ? raw.line_items
        : [];
    // I22: números tolerantes — acepta "429.352", "110,000.00", "$ 429352"
    const numero = (v: any): number | null => {
      if (v === null || v === undefined || v === '') return null;
      if (typeof v === 'number') return Number.isFinite(v) ? v : null;
      const limpio = String(v)
        .replace(/[^\d.,-]/g, '')
        .replace(/\.(?=\d{3}\b)/g, '') // puntos de miles
        .replace(',', '.');
      const n = Number(limpio);
      return Number.isFinite(n) ? n : null;
    };
    const texto = (v: any): string | null =>
      v === null || v === undefined || v === '' ? null : String(v);
    const cab = (campo: string): any =>
      porAlias(raw, [campo, ...ALIAS_CABECERA[campo]]);
    const itemsMapeados = items
      .map((i: any) => {
        const ref = porAlias(i, ['referencia', ...ALIAS_ITEM.referencia]);
        return {
          referencia: ref ? String(ref) : '',
          descripcion: texto(porAlias(i, ALIAS_ITEM.descripcion)),
          cantidad: numero(porAlias(i, ALIAS_ITEM.cantidad)) ?? 0,
          unidad: texto(porAlias(i, ALIAS_ITEM.unidad)) ?? 'UND',
          valorUnitario: numero(porAlias(i, ALIAS_ITEM.valorUnitario)),
          valorTotal: numero(porAlias(i, ALIAS_ITEM.valorTotal)),
        };
      })
      .filter((i) => i.referencia);
    if (items.length > 0 && itemsMapeados.length === 0) {
      this.logger.warn(
        `LLM devolvió ${items.length} ítems sin referencia reconocible: ${JSON.stringify(items[0]).slice(0, 200)}`,
      );
    }
    return {
      numeroFactura: texto(cab('numeroFactura')),
      fecha: texto(cab('fecha')),
      proveedor: texto(cab('proveedor')),
      cliente: texto(cab('cliente')),
      nit: texto(cab('nit')),
      telefono: texto(cab('telefono')),
      direccion: texto(cab('direccion')),
      numeroGuia: texto(cab('numeroGuia')),
      transportadora: texto(cab('transportadora')),
      total: numero(cab('total')),
      observaciones: texto(cab('observaciones')),
      items: itemsMapeados.map((i) => ({ ...i, cantidad: Math.trunc(i.cantidad) })),
    };
  }
}
