import { DocumentType } from '../../common/enums/document-type.enum';

/** Item extraído de un documento (línea de producto). */
export interface OcrItem {
  referencia: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

/**
 * Estructura genérica de datos extraídos (M13 / HU-021).
 * Sirve para facturas de importación (ingreso), órdenes de pedido,
 * facturas de venta y guías; los flujos I6/I7/I8 la consumen.
 */
export interface OcrExtractedData {
  numeroFactura: string | null;
  fecha: string | null;
  proveedor: string | null;
  cliente: string | null;
  direccion: string | null;
  numeroGuia: string | null;
  transportadora: string | null;
  items: OcrItem[];
}

const UNIDADES = ['UND', 'UN', 'UNIDAD', 'PCS', 'PZA', 'CAJA', 'CJ', 'PAR', 'JGO', 'KIT', 'LT', 'KG'];

function empty(): OcrExtractedData {
  return {
    numeroFactura: null,
    fecha: null,
    proveedor: null,
    cliente: null,
    direccion: null,
    numeroGuia: null,
    transportadora: null,
    items: [],
  };
}

/** Normaliza una fecha reconocida a ISO (YYYY-MM-DD) cuando es posible. */
function toIso(dia: string, mes: string, anio: string): string | null {
  const d = parseInt(dia, 10);
  const m = parseInt(mes, 10);
  let y = parseInt(anio, 10);
  if (anio.length === 2) y += y < 70 ? 2000 : 1900;
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  return `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d
    .toString()
    .padStart(2, '0')}`;
}

/**
 * Parser heurístico de texto OCR (motor local). Busca patrones comunes de
 * facturas/órdenes/guías en español e inglés. Es tolerante a ruido: lo que
 * no reconoce queda null para corrección manual (CU-009, baja confianza).
 */
export class OcrFieldParser {
  parse(texto: string, _tipo: DocumentType): OcrExtractedData {
    const data = empty();
    if (!texto) return data;
    const lineas = texto
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    for (const linea of lineas) {
      this.parseCabecera(linea, data);
      const item = this.parseLineaItem(linea);
      if (item) data.items.push(item);
    }
    return data;
  }

  // ---------------------------------------------------------------

  private parseCabecera(linea: string, data: OcrExtractedData) {
    const l = linea;

    // Número de factura / invoice
    if (!data.numeroFactura) {
      const m =
        /(?:factura|invoice|inv|fact|remisi[oó]n)\s*(?:n(?:ro|um|úmero)?[°#.:]*)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,24})/i.exec(l);
      if (m && !/^\d{1,2}[/-]\d{1,2}[/-]/.test(m[1])) data.numeroFactura = m[1].toUpperCase();
    }

    // Número de guía
    if (!data.numeroGuia) {
      const m = /(?:gu[ií]a|tracking|shipment)\s*(?:n(?:ro|um|úmero)?[°#.:]*)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,24})/i.exec(l);
      if (m) data.numeroGuia = m[1].toUpperCase();
    }

    // Fecha (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YY)
    if (!data.fecha) {
      const iso = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(l);
      const lat = /(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(l);
      if (iso) {
        data.fecha = toIso(iso[3], iso[2], iso[1]);
      } else if (lat && /fecha|date/i.test(l)) {
        data.fecha = toIso(lat[1], lat[2], lat[3]);
      }
    }

    // Proveedor / cliente / dirección / transportadora (etiqueta: valor)
    const campo = (regex: RegExp): string | null => {
      const m = regex.exec(l);
      return m ? m[1].trim() : null;
    };
    if (!data.proveedor) {
      const v = campo(/(?:proveedor|supplier|vendor|remitente)\s*[:.-]\s*(.+)/i);
      if (v) data.proveedor = v;
    }
    if (!data.cliente) {
      const v = campo(/(?:cliente|customer|client|destinatario|consignado)\s*[:.-]\s*(.+)/i);
      if (v) data.cliente = v;
    }
    if (!data.direccion) {
      const v = campo(/(?:direcci[oó]n|address|dir)\s*[:.-]\s*(.+)/i);
      if (v) data.direccion = v;
    }
    if (!data.transportadora) {
      const v = campo(/(?:transportadora|carrier|transportista)\s*[:.-]\s*(.+)/i);
      if (v) data.transportadora = v;
    }
  }

  /**
   * Línea de producto: REFERENCIA + descripción + cantidad (+ unidad).
   * Formatos soportados:
   *   REF-1001 OIL FILTER 10 UND
   *   REF-1002 | BRAKE PADS | 5
   */
  private parseLineaItem(linea: string): OcrItem | null {
    // Separadores de tabla
    const partes = linea.includes('|')
      ? linea.split('|').map((p) => p.trim()).filter(Boolean)
      : linea.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);

    if (partes.length >= 2) {
      const [ref, ...resto] = partes;
      if (!/^[A-Z0-9][A-Z0-9-_.]{2,24}$/i.test(ref)) return null;
      const { cantidad, unidad, descripcion } = this.extraerCantidad(resto.join(' '));
      if (cantidad === null) return null;
      return {
        referencia: ref.toUpperCase(),
        descripcion: descripcion || null,
        cantidad,
        unidad: unidad ?? 'UND',
      } as OcrItem;
    }

    // Línea plana: REF DESCRIPCION CANTIDAD [UNIDAD]
    const m =
      /^([A-Z0-9][A-Z0-9-_.]{2,24})\s+(.+?)\s+(\d{1,6})(?:\s+([A-Z]{2,7}))?$/i.exec(linea);
    if (!m) return null;
    const unidad = m[4] && UNIDADES.includes(m[4].toUpperCase()) ? m[4].toUpperCase() : m[4] ? null : 'UND';
    if (m[4] && unidad === null) {
      // La palabra final no es unidad conocida: la tratamos como parte de la descripción con cantidad ambigua → descartar
      return null;
    }
    const ref = m[1].toUpperCase();
    // Evitar falsos positivos de cabeceras
    if (/^(FACTURA|INVOICE|FECHA|DATE|GUIA|TOTAL)$/i.test(ref)) return null;
    return {
      referencia: ref,
      descripcion: m[2].trim(),
      cantidad: parseInt(m[3], 10),
      unidad: unidad ?? 'UND',
    };
  }

  private extraerCantidad(texto: string): {
    cantidad: number | null;
    unidad: string | null;
    descripcion: string;
  } {
    const m = /^(.*?)\s+(\d{1,6})(?:\s+([A-Za-z]{2,7}))?$/.exec(texto.trim());
    if (!m) return { cantidad: null, unidad: null, descripcion: texto };
    let unidad: string | null = null;
    let descripcion = m[1].trim();
    if (m[3]) {
      if (UNIDADES.includes(m[3].toUpperCase())) {
        unidad = m[3].toUpperCase();
      } else {
        descripcion = `${m[1]} ${m[2]}`.trim();
        return { cantidad: null, unidad: null, descripcion };
      }
    }
    return { cantidad: parseInt(m[2], 10), unidad, descripcion };
  }
}
