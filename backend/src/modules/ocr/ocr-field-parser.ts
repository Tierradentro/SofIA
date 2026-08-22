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

/** Meses en español para fechas "14-ago-26" (facturas colombianas, I22). */
const MESES_ES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12,
};

/**
 * I22: el número de factura suele estar en la línea del encabezado
 * ("FACTURA ELECTRÓNICA DE VENTA N° FEIR 10022") con el folio al FINAL.
 * Patrones tolerantes a los rótulos comunes; captura prefijo + número.
 */
const PATRONES_FOLIO: RegExp[] = [
  /factura\s+electr[oó]nica(?:\s+de\s+venta)?[^A-Z0-9]{0,10}(?:n[°.o:]?\s*)?([A-Z]{1,6}[- ]?\d{3,})/i,
  // I26: prefijo y número separados por muchos espacios (layout de columnas):
  // "FACTURA ELECTRÓNICA FE                                  9832"
  /factura\s+electr[oó]nica\b[^0-9]{0,40}?([A-Z]{1,6}\s{2,}\d{3,})\b/i,
  /factura\s+de\s+venta[^A-Z0-9]{0,10}(?:n[°.o:]?\s*)?([A-Z]{1,6}[- ]?\d{3,})/i,
  /factura\s*(?:n(?:ro|um|úmero)?[°#.:]*)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,24})/i,
  /\b(?:n[°o]|no\.?|#)\s*([A-Z]{1,6}[- ]?\d{3,})\b/i,
  // I26 (ICV): el folio va en línea propia: "FECV              No. 3440"
  /\b([A-Z]{2,6}\s{1,20}(?:NO\.?|N[°O])\s*\.?\s*\d{3,6})\b/i,
];

/** I26: normaliza el folio capturado (quita el rótulo "No." interno y espacios). */
function normalizarFolio(bruto: string): string {
  return bruto
    .replace(/(?:NO\.?|N[°O])\s*\.?/i, '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** Referencia de producto válida (I26: admite '/' — p. ej. "10086/10094"). */
const REF_RE = /^[A-Z0-9][A-Z0-9\-_./]{2,24}$/i;

/** Rótulos de cabecera/tabla que NUNCA son referencias de producto. */
const ROTULOS_RE =
  /^(NIT|CLIENTE|DIRECCION|TELEFONO|CIUDAD|FECHA|VENDEDOR|FORMA|ITEM|REFERENCIA|SUBTOTAL|TOTAL|FACTURA|ACTIVIDAD|NO|CODIGO|DESCRIPCION|CANTIDAD|VALOR|VENCE|RESPONSABLE|MEDIOS|PAGO)$/i;

function capturarRef(token: string): string | null {
  return REF_RE.test(token) && !ROTULOS_RE.test(token) ? token : null;
}

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

    let previa: string | null = null;
    let pendienteFilaDir = false;
    let ultimoItem: OcrItem | null = null;
    for (const linea of lineas) {
      // I26 (ICV): fila de rótulos "DIRECCIÓN  CIUDAD  TELÉFONO" con los
      // valores en la línea siguiente (layout de dos líneas)
      if (pendienteFilaDir) {
        pendienteFilaDir = false;
        this.aplicarFilaDireccion(linea, data, esquema.cabecera);
      } else if (/^DIRECCI[OÓ]N\s{2,}CIUDAD\s{2,}TEL[EÉ]FONO/i.test(linea)) {
        pendienteFilaDir = true;
        previa = linea;
        continue; // la fila de rótulos no es dato
      }
      // I26 (IRE): "TELEFONO" queda solo como rótulo; el número está en la
      // primera columna de la línea anterior
      if (
        /^TELEFONO$/i.test(linea) &&
        previa &&
        !data.telefono &&
        esquema.cabecera.includes('telefono')
      ) {
        const cols = previa.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
        const m = /^([0-9][0-9+()\- ]{6,18})/.exec(cols[0] ?? '');
        if (m) data.telefono = m[1].trim();
      }
      this.parseCabecera(linea, data, esquema.cabecera);
      const item = this.parseLineaItem(linea, conValor);
      if (item) {
        data.items.push(item);
        ultimoItem = item;
      } else if (ultimoItem && this.esContinuacionDescripcion(linea)) {
        // I26 (ICV): la descripción puede continuar en la línea siguiente
        ultimoItem.descripcion = ultimoItem.descripcion
          ? `${ultimoItem.descripcion} ${linea}`
          : linea;
      } else {
        ultimoItem = null;
      }
      previa = linea;
    }
    return data;
  }

  /** I26: valores bajo los rótulos DIRECCIÓN / CIUDAD / TELÉFONO. */
  private aplicarFilaDireccion(
    linea: string,
    data: OcrExtractedData,
    cabecera: string[],
  ) {
    const cols = linea.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (!cols.length) return;
    if (!data.direccion && cabecera.includes('direccion')) {
      let dir = cols[0];
      // La ciudad puede venir pegada a la dirección ("…A 44Sincelejo")
      const pegada = /^(.*\d)\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})$/.exec(dir);
      if (pegada) dir = pegada[1];
      if (dir.trim()) data.direccion = dir.trim();
    }
    if (!data.telefono && cabecera.includes('telefono')) {
      const tel = cols.find((c) => {
        const digitos = c.replace(/\D/g, '');
        return digitos.length >= 7 && digitos.length <= 12;
      });
      if (tel) data.telefono = tel.trim();
    }
  }

  /**
   * I26: ¿la línea es continuación de la descripción del ítem anterior?
   * (solo palabras, sin valores monetarios ni rótulos conocidos)
   */
  private esContinuacionDescripcion(l: string): boolean {
    if (!/^[A-ZÁÉÍÓÚÑ(]/i.test(l)) return false;
    if (/\d{1,3}[.,]\d{3}/.test(l)) return false; // valores de miles
    if (/\d{3,}/.test(l)) return false; // CUFE, teléfonos, cuentas
    if (l.length > 70) return false;
    return !/VALOR EN LETRAS|SUBTOTAL|TOTAL|DESCUENTO|RETE|IVA\b|CLIENTE|NIT\b|DIRECCION|CIUDAD|TELEFONO|FECHA|VENDEDOR|FORMA DE PAGO|FAVOR|DAVIVIENDA|RECIBIDO|FIRMA|CUFE|PESOS|CHEQUE|FABRICANTE|REPRESENTACI|ITEM|REFERENCIA|DESCRIPCI|VENCE|MEDIOS DE PAGO/i.test(l);
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
      for (const patron of PATRONES_FOLIO) {
        const m = patron.exec(l);
        if (
          m &&
          /\d/.test(m[1]) && // un folio siempre tiene dígitos (evita "FECHA", "ELECTR")
          !/^\d{1,2}[/-]\d{1,2}[/-]/.test(m[1]) &&
          !/^(FACT|INVOICE|ELECTR.*|VENTA|DE)$/i.test(m[1])
        ) {
          data.numeroFactura = normalizarFolio(m[1]);
          break;
        }
      }
      // Respaldo legacy: invoice / remisión
      if (!data.numeroFactura) {
        const m =
          /(?:invoice|inv|remisi[oó]n)\s*(?:n(?:ro|um|úmero)?[°#.:]*)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{2,24})/i.exec(l);
        if (m && !/^\d{1,2}[/-]\d{1,2}[/-]/.test(m[1])) data.numeroFactura = m[1].toUpperCase();
      }
    }

    // Número de guía
    if (!data.numeroGuia) {
      const m = /(?:gu[ií]a|tracking|shipment)\s*(?:n(?:ro|um|úmero)?[°#.:]*)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{3,24})/i.exec(l);
      if (m) data.numeroGuia = m[1].toUpperCase();
    }

    // Fecha (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YY, y "14-ago-26" colombiano)
    if (!data.fecha) {
      const iso = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(l);
      const lat = /(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(l);
      const textoMes =
        /(\d{1,2})\s*[-/]\s*([a-záéíóú]{3,5})\.?\s*[-/]\s*(\d{2,4})/i.exec(l);
      // I26: la fecha ISO también exige contexto — "Vence 2027-07-13" del
      // encabezado DIAN no es la fecha de la factura
      if (iso && /fecha|date|generaci|expedici|emisi/i.test(l)) {
        data.fecha = toIso(iso[3], iso[2], iso[1]);
      } else if (textoMes && /fecha|date|factura/i.test(l)) {
        const mes = MESES_ES[textoMes[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
        if (mes) data.fecha = toIso(textoMes[1], String(mes), textoMes[3]);
      } else if (lat && /fecha|date/i.test(l)) {
        data.fecha = toIso(lat[1], lat[2], lat[3]);
      } else {
        // I26 (ICV): los valores van bajo los rótulos — una línea que
        // ARRANCA con una fecha es la fila de valores ("20/08/2026  19/09/2026 …")
        const iniIso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s|$)/.exec(l);
        const iniLat = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:\s|$)/.exec(l);
        if (iniIso) data.fecha = toIso(iniIso[3], iniIso[2], iniIso[1]);
        else if (iniLat) data.fecha = toIso(iniLat[1], iniLat[2], iniLat[3]);
      }
    }

    // Proveedor / cliente / dirección / transportadora (etiqueta: valor)
    const campo = (regex: RegExp): string | null => {
      const m = regex.exec(l);
      return m ? m[1].trim() : null;
    };
    // I22: PDFs con layout de columnas — "CLIENTE   REPUESTOS S.A.S"
    // (espacios en vez de dos puntos). El valor es lo que sigue a la
    // etiqueta + 2+ espacios, cortando antes de la siguiente etiqueta de
    // columna (también separada por espacios amplios).
    const CORTE = '(?:FECHA|VENDEDOR|FORMA|CIUDAD|TELEFONO|NIT|DIRECCION|SUBTOTAL|TOTAL|CLIENTE)';
    if (!data.proveedor && aplica('proveedor')) {
      const v =
        campo(new RegExp(`(?:^|\\s)(?:proveedor|supplier|vendor|remitente)\\s*[:.-]\\s*(.+?)\\s*(?=${CORTE}\\s|$)`, 'i')) ??
        campo(/(?:proveedor|supplier|vendor|remitente)\s{2,}(\S(?:.+?))\s*(?=FECHA|VENDEDOR|FORMA|$)/i);
      if (v) data.proveedor = v;
    }
    if (!data.cliente && aplica('cliente')) {
      const v =
        campo(new RegExp(`(?:^|\\s)(?:cliente|customer|destinatario|consignado)\\s*[:.-]\\s*(.+?)\\s*(?=${CORTE}\\s|$)`, 'i')) ??
        campo(/(?:^|\s)(?:cliente|customer|destinatario|consignado)\s{2,}(\S(?:.+?))\s*(?=FECHA|VENDEDOR|FORMA|$)/i) ??
        // I26 (ICV): "CLIENTE SOMOS CHEVROLET… POR CONCEPTO DE" — un solo
        // espacio tras el rótulo y el texto de otra columna pegado al final
        campo(/^\s*(?:cliente|customer)\s+(\S(?:.*?))\s*(?:\s{2,}|\bPOR CONCEPTO\b(?:\s*DE)?|\bFACTURA\b|$)/i);
      if (v) data.cliente = v;
    }
    // QA Func. 2.5: NIT/identificación y teléfono (ventas)
    if (!data.nit && aplica('nit')) {
      const v =
        campo(/(?:N\.?I\.?T\.?|identificaci[oó]n|c[ée]dula|c\.?c\.?)\s*[:.-]?\s*([0-9][0-9.\-]{4,19})/i) ??
        campo(/^\s*NIT\s{2,}([0-9][0-9.\- ]{4,19})/i);
      if (v) data.nit = v.trim();
    }
    if (!data.telefono && aplica('telefono')) {
      const v =
        campo(/(?:tel[eé]fono|tel|celular|phone)\s*[:.-]?\s*([0-9+()\- ]{7,20})/i) ??
        campo(/^\s*TELEFONO\s{2,}([0-9+()\- ]{7,20})/i);
      if (v) data.telefono = v.trim();
    }
    if (!data.direccion && aplica('direccion')) {
      const v =
        campo(new RegExp(`(?:^|\\s)(?:direcci[oó]n|address)\\s*[:.-]\\s*(.+?)\\s*(?=${CORTE}\\s|$)`, 'i')) ??
        campo(/(?:^|\s)(?:direcci[oó]n|address|DIRECCION)\s{2,}(\S(?:.+?))\s*(?=FECHA|VENDEDOR|FORMA|CIUDAD|$)/i);
      if (v) data.direccion = v;
    }
    if (!data.transportadora && aplica('transportadora')) {
      const v = campo(/(?:transportadora|carrier|transportista)\s*[:.-]\s*(.+)/i);
      if (v) data.transportadora = v;
    }
    // I22: total del documento ("TOTAL FACTURA 429.352") — el último valor
    // monetario de la línea
    if ((data.total === null || data.total === undefined) && aplica('total')) {
      const linea = /total\s*(?:factura|a\s*pagar)?\s*[:$]?\s*(.*)/i.exec(l);
      // I26: "TOTAL MENOS RETENCIONES" sí es total; "RETEFUENTE/RETEIVA/RETEICA" no
      if (linea && !/subtotal|\brete(?:fuente|iva|ica)\b|iva\b/i.test(l.replace(/total factura/i, ''))) {
        const moneda = [...linea[1].matchAll(/\$?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2})/g)];
        if (moneda.length) {
          const ultimo = moneda[moneda.length - 1][1];
          data.total = Number(ultimo.replace(/\./g, '').replace(',', '.'));
        }
      }
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
      // I22: tablas con número de ítem al inicio ("1  REF  DESCRIPCIÓN  ...")
      // y sin separador entre referencia y descripción
      let ref = partes[0];
      let resto = partes.slice(1);
      if (/^\d{1,3}$/.test(ref) && resto.length >= 1) {
        if (resto[0].includes(' ')) {
          const [ref2, ...desc] = resto[0].split(/\s+/);
          const ok = capturarRef(ref2);
          if (ok) {
            ref = ok;
            resto = [desc.join(' '), ...resto.slice(1)];
          }
        } else if (resto.length >= 2) {
          // I26: layout de columnas anchas — referencia y descripción quedan
          // en columnas separadas ("1   N1063   AXIAL R/L …   3,00  24.000  72.000")
          const ok = capturarRef(resto[0]);
          if (ok) {
            ref = ok;
            resto = resto.slice(1);
          }
        }
      }
      if (!capturarRef(ref)) return null;
      // I22: en documentos de venta las columnas son …cantidad, valorUnitario,
      // valorTotal. La cantidad puede tener decimales ("4,00") y el patrón
      // monetario se la traga; por eso se extraen los números del FINAL de la
      // línea en orden: cantidad = primero, luego unitario y total.
      let valores: { unitario: number | null; total: number | null } = {
        unitario: null,
        total: null,
      };
      let textoResto = resto.join(' ');
      if (conValor) {
        // I26 (ICV): layout con columna de unidad — "… 3  Und.  68.000 19%  10.982  204.000".
        // La cantidad va ANTES de la unidad; detrás van unitario, IVA% y total.
        const idxUnidad = resto.findIndex((p) =>
          UNIDADES.includes(p.replace(/\./g, '').toUpperCase()),
        );
        if (idxUnidad > 0) {
          const antes = resto.slice(0, idxUnidad).join(' ');
          const mCant = /^(.*?)\s+(\d{1,6}(?:[.,]\d{1,2})?)$/.exec(antes);
          if (mCant) {
            const despues = resto.slice(idxUnidad + 1).join(' ');
            const nums = [
              ...despues.matchAll(
                /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+)/g,
              ),
            ].map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')));
            const cantidad = Math.round(Number(mCant[2].replace(',', '.')));
            if (cantidad > 0) {
              return {
                referencia: ref.toUpperCase(),
                descripcion: mCant[1].trim() || null,
                cantidad,
                unidad: 'UND',
                valorUnitario: nums.length >= 2 ? nums[0] : null,
                valorTotal: nums.length ? nums[nums.length - 1] : null,
              } as OcrItem;
            }
          }
        }
        const extraidos = this.extraerColaNumerica(textoResto);
        if (extraidos) {
          return {
            referencia: ref.toUpperCase(),
            descripcion: extraidos.resto || null,
            cantidad: extraidos.cantidad,
            unidad: 'UND',
            valorUnitario: extraidos.unitario,
            valorTotal: extraidos.total,
          } as OcrItem;
        }
        // Formato sin valores monetarios: "REF | DESC | 12 | UND" — la
        // cantidad está seguida de una unidad conocida
        const partesCola = resto.join(' ');
        const conUnidad = /^(.*?)\s+(\d{1,6}(?:[.,]\d{1,2})?)\s+([A-Za-z]{2,7})$/.exec(partesCola);
        if (conUnidad && UNIDADES.includes(conUnidad[3].toUpperCase())) {
          return {
            referencia: ref.toUpperCase(),
            descripcion: conUnidad[1].trim() || null,
            cantidad: Math.round(Number(conUnidad[2].replace(',', '.'))),
            unidad: conUnidad[3].toUpperCase(),
            valorUnitario: null,
            valorTotal: null,
          } as OcrItem;
        }
        return null;
      }
      const { cantidad, unidad, descripcion } = this.extraerCantidad(textoResto);
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
      /^([A-Z0-9][A-Z0-9\-_./]{2,24})\s+(.+?)\s+(\d{1,6})(?:\s+([A-Z]{2,7}))?$/i.exec(linea);
    if (!m) return null;
    const unidad = m[4] && UNIDADES.includes(m[4].toUpperCase()) ? m[4].toUpperCase() : m[4] ? null : 'UND';
    if (m[4] && unidad === null) {
      // La palabra final no es unidad conocida: la tratamos como parte de la descripción con cantidad ambigua → descartar
      return null;
    }
    const ref = m[1].toUpperCase();
    // Evitar falsos positivos de cabeceras (I26: lista ampliada de rótulos)
    if (ROTULOS_RE.test(ref) || /^(INVOICE|DATE|GUIA)$/i.test(ref)) return null;
    return {
      referencia: ref,
      descripcion: m[2].trim(),
      cantidad: parseInt(m[3], 10),
      unidad: unidad ?? 'UND',
    };
  }

  /**
   * I22: cola numérica de una línea de venta — "… DESCRIPCIÓN 4,00 110.000
   * 440.000" → cantidad 4, unitario 110000, total 440000. Se toman del final:
   * [cantidad] [unitario] [total]; con 2 números son cantidad + total.
   * La descripción es lo que queda antes.
   */
  private extraerColaNumerica(texto: string): {
    resto: string;
    cantidad: number;
    unitario: number | null;
    total: number | null;
  } | null {
    const NUM = /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+)/g;
    const matches = [...texto.matchAll(NUM)].filter((m) => {
      // Solo números al final de la línea o separados por espacios (columnas)
      const antes = texto.slice(0, m.index).trimEnd();
      return antes === '' || /\s$/.test(texto.slice(0, m.index));
    });
    if (matches.length < 2) return null;
    // Los últimos 2-3 números son cantidad/valores
    const cola = matches.slice(-3);
    const numeros = cola.map((m) =>
      Number(m[1].replace(/\./g, '').replace(',', '.')),
    );
    const cantidad = Math.round(numeros[0]);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
    const resto = texto.slice(0, cola[0].index).replace(/\s{2,}/g, ' ').trim();
    return {
      resto,
      cantidad,
      unitario: numeros.length === 3 ? numeros[1] : null,
      total: numeros[numeros.length - 1],
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
    const m = /^(.*?)\s+(\d{1,6}(?:[.,]\d{1,2})?)(?:\s+([A-Za-z]{2,7}))?$/.exec(texto.trim());
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
    // I22: cantidad con decimales de factura ("4,00") → entero redondeado
    const cantidad = Math.round(Number(m[2].replace(',', '.')));
    return { cantidad, unidad, descripcion };
  }
}
