import { DocumentType } from '../../common/enums/document-type.enum';

/** Item extraído de un documento (línea de producto). */
export interface OcrItem {
  referencia: string;
  descripcion: string | null;
  cantidad: number;
  unidad: string;
  /** QA Func. 2.5: valor unitario por ítem (pedidos/cotizaciones/facturas). */
  valorUnitario?: number | null;
  valorTotal?: number | null;
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
  /** QA Func. 2.5: NIT/identificación y teléfono (ventas). */
  nit: string | null;
  telefono: string | null;
  direccion: string | null;
  numeroGuia: string | null;
  transportadora: string | null;
  items: OcrItem[];
  /** QA Func. 2.5: totales del documento cuando aparecen. */
  total?: number | null;
  observaciones?: string | null;
}

/**
 * QA Func. 2.5: esquema de extracción variable por tipo de documento.
 * Cada tipo define qué campos de cabecera y de ítem aplican.
 */
export const OCR_CAMPOS_POR_TIPO: Record<
  DocumentType,
  { cabecera: string[]; itemFields: string[] }
> = {
  [DocumentType.FACTURA_IMPORTACION]: {
    cabecera: [
      'numeroFactura', 'fecha', 'proveedor', 'numeroGuia',
      'transportadora', 'direccion',
    ],
    itemFields: ['referencia', 'descripcion', 'cantidad', 'unidad'],
  },
  [DocumentType.ORDEN_PEDIDO]: {
    cabecera: ['numeroFactura', 'fecha', 'cliente', 'nit', 'direccion', 'telefono'],
    itemFields: [
      'referencia', 'descripcion', 'cantidad', 'unidad',
      'valorUnitario', 'valorTotal',
    ],
  },
  [DocumentType.COTIZACION]: {
    cabecera: ['numeroFactura', 'fecha', 'cliente', 'nit', 'direccion', 'telefono'],
    itemFields: [
      'referencia', 'descripcion', 'cantidad', 'unidad',
      'valorUnitario', 'valorTotal',
    ],
  },
  [DocumentType.FACTURA_VENTA]: {
    cabecera: [
      'numeroFactura', 'fecha', 'cliente', 'nit', 'direccion',
      'telefono', 'total', 'observaciones',
    ],
    itemFields: [
      'referencia', 'descripcion', 'cantidad', 'unidad',
      'valorUnitario', 'valorTotal',
    ],
  },
  [DocumentType.GUIA_TRANSPORTE]: {
    cabecera: [
      'numeroGuia', 'fecha', 'transportadora', 'cliente', 'direccion',
    ],
    itemFields: ['referencia', 'descripcion', 'cantidad', 'unidad'],
  },
  [DocumentType.SOPORTE_PQRS]: {
    cabecera: ['numeroFactura', 'fecha', 'cliente', 'observaciones'],
    itemFields: ['referencia', 'descripcion', 'cantidad', 'unidad'],
  },
  [DocumentType.LOGO]: { cabecera: [], itemFields: [] },
};

/** Tipos cuyos ítems llevan valor/precio. */
const TIPOS_CON_VALOR: DocumentType[] = [
  DocumentType.ORDEN_PEDIDO,
  DocumentType.COTIZACION,
  DocumentType.FACTURA_VENTA,
];

const UNIDADES = ['UND', 'UN', 'UNIDAD', 'PCS', 'PZA', 'CAJA', 'CJ', 'PAR', 'JGO', 'KIT', 'LT', 'KG'];

function empty(): OcrExtractedData {
  return {
    numeroFactura: null,
    fecha: null,
    proveedor: null,
    cliente: null,
    nit: null,
    telefono: null,
    direccion: null,
    numeroGuia: null,
    transportadora: null,
    items: [],
    total: null,
    observaciones: null,
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
  parse(texto: string, tipo: DocumentType): OcrExtractedData {
    const data = empty();
    if (!texto) return data;
    const esquema = OCR_CAMPOS_POR_TIPO[tipo];
    const conValor = TIPOS_CON_VALOR.includes(tipo);
    const lineas = texto
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    for (const linea of lineas) {
      this.parseCabecera(linea, data, esquema.cabecera);
      const item = this.parseLineaItem(linea, conValor);
      if (item) data.items.push(item);
    }
    return data;
  }

  // ---------------------------------------------------------------

  private parseCabecera(
    linea: string,
    data: OcrExtractedData,
    cabecera: string[],
  ) {
    const l = linea;
    const aplica = (campo: string) => cabecera.includes(campo);

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
    if (!data.proveedor && aplica('proveedor')) {
      const v = campo(/(?:proveedor|supplier|vendor|remitente)\s*[:.-]\s*(.+)/i);
      if (v) data.proveedor = v;
    }
    if (!data.cliente && aplica('cliente')) {
      const v = campo(/(?:cliente|customer|client|destinatario|consignado)\s*[:.-]\s*(.+)/i);
      if (v) data.cliente = v;
    }
    // QA Func. 2.5: NIT/identificación y teléfono (ventas)
    if (!data.nit && aplica('nit')) {
      const v = campo(/(?:N\.?I\.?T\.?|identificaci[oó]n|c[ée]dula|c\.?c\.?)\s*[:.-]?\s*([0-9][0-9.\-]{4,19})/i);
      if (v) data.nit = v;
    }
    if (!data.telefono && aplica('telefono')) {
      const v = campo(/(?:tel[eé]fono|tel|celular|phone)\s*[:.-]?\s*([0-9+()\- ]{7,20})/i);
      if (v) data.telefono = v;
    }
    if (!data.direccion && aplica('direccion')) {
      const v = campo(/(?:direcci[oó]n|address|dir)\s*[:.-]\s*(.+)/i);
      if (v) data.direccion = v;
    }
    if (!data.transportadora && aplica('transportadora')) {
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
  private parseLineaItem(linea: string, conValor: boolean): OcrItem | null {
    // Separadores de tabla
    const partes = linea.includes('|')
      ? linea.split('|').map((p) => p.trim()).filter(Boolean)
      : linea.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean);

    if (partes.length >= 2) {
      const [ref, ...resto] = partes;
      if (!/^[A-Z0-9][A-Z0-9-_.]{2,24}$/i.test(ref)) return null;
      // QA Func. 2.5: en documentos de venta, los últimos valores numéricos
      // con separador de miles/decimales son valor unitario/total
      let valores: { unitario: number | null; total: number | null } = {
        unitario: null,
        total: null,
      };
      let textoResto = resto.join(' ');
      if (conValor) {
        const extraidos = this.extraerValores(textoResto);
        textoResto = extraidos.resto;
        valores = { unitario: extraidos.unitario, total: extraidos.total };
      }
      const { cantidad, unidad, descripcion } = this.extraerCantidad(textoResto);
      if (cantidad === null) return null;
      return {
        referencia: ref.toUpperCase(),
        descripcion: descripcion || null,
        cantidad,
        unidad: unidad ?? 'UND',
        ...(conValor ? { valorUnitario: valores.unitario, valorTotal: valores.total } : {}),
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

  /**
   * Extrae valor unitario/total del final de la línea (números con formato
   * monetario: 25.000, 25,000.00, $25.000). Devuelve el texto restante.
   */
  private extraerValores(texto: string): {
    resto: string;
    unitario: number | null;
    total: number | null;
  } {
    const MONEDA = /\$?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2})/g;
    const matches = [...texto.matchAll(MONEDA)];
    if (matches.length === 0) return { resto: texto, unitario: null, total: null };
    const numeros = matches.map((m) =>
      Number(m[1].replace(/\./g, '').replace(',', '.')),
    );
    let resto = texto;
    for (const m of matches) resto = resto.replace(m[0], ' ');
    resto = resto.replace(/\s{2,}/g, ' ').trim();
    return {
      resto,
      unitario: numeros[0],
      total: numeros.length > 1 ? numeros[numeros.length - 1] : null,
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
