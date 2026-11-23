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
  /**
   * I71 (facturas de compra): empresa EMISORA del documento — nombre en el
   * encabezado (antes del rótulo "FACTURA DE COMPRA") y su NIT. El ingreso
   * de mercancía valida que corresponda a la empresa de la actividad.
   */
  empresaFactura: string | null;
  nitEmpresa: string | null;
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
      'transportadora', 'direccion', 'total', 'empresaFactura', 'nitEmpresa',
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
  // I41: la foto del producto no pasa por OCR
  [DocumentType.FOTO_PRODUCTO]: { cabecera: [], itemFields: [] },
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
  // I39: nombres completos para fechas largas ("24 de julio de 2026")
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/**
 * I22: el número de factura suele estar en la línea del encabezado
 * ("FACTURA ELECTRÓNICA DE VENTA N° FEIR 10022") con el folio al FINAL.
 * Patrones tolerantes a los rótulos comunes; captura prefijo + número.
 */
const PATRONES_FOLIO: RegExp[] = [
  // I39: factura de compra extranjera — "FACTURA DE COMPRA  61" (el folio va
  // al final de la línea del título, sin prefijo ni rótulo "No.")
  /factura\s+de\s+compra(?:\s+extranjera)?\s+(\d{1,7})\b/i,
  // I74: registro de IMPORTACIÓN del mismo ERP (sin el rótulo "FACTURA") —
  // "IMPORT - REPUESTOS EL ESCARABAJO IMPORTACION                  233"
  /\bIMPORTACI[OÓ]N\s+(\d{1,7})\s*$/i,
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
// I64b: las referencias de WO pueden traer separador ':' (p. ej. 560277/315910:0 truncado de 560277/315910:009).
const REF_RE = /^[A-Z0-9][A-Z0-9\-_./:]{2,24}$/i;

/** Rótulos de cabecera/tabla que NUNCA son referencias de producto. */
const ROTULOS_RE =
  /^(NIT|CLIENTE|DIRECCION|TELEFONO|CIUDAD|FECHA|VENDEDOR|FORMA|ITEM|REFERENCIA|SUBTOTAL|TOTAL|FACTURA|ACTIVIDAD|NO|CODIGO|DESCRIPCION|CANTIDAD|VALOR|VENCE|RESPONSABLE|MEDIOS|PAGO)$/i;

/**
 * I74: palabras que abren una DIRECCIÓN postal (colombiana o brasileña).
 * Una línea de dirección puede terminar en número ("RUA JOAO THOMAZ … EXT 2")
 * y, sin esta guarda, el parser la tomaba como ítem con referencia "RUA" y
 * cantidad 2. Ninguna referencia de repuesto empieza con estas palabras.
 */
const REF_DIRECCION_RE =
  /^(RUA|AV|AVE|AVENIDA|CALLE|CARRERA|CRA|KR|CL|DIAGONAL|DIAG|TRANSVERSAL|TRANSV|TV|MANZANA|MZ|BLOQUE|BARRIO|KM)$/i;

function capturarRef(token: string): string | null {
  return REF_RE.test(token) && !ROTULOS_RE.test(token) ? token : null;
}

/**
 * I68 (facturas ICV/FECV): en la tabla de ítems la descripción queda PEGADA
 * a la referencia sin espacio — "1J0129684CGMANGUERA", "191598625ARKIT",
 * "TC-355-11-2MEMPAQUE". Si el token termina en un nombre de repuesto y el
 * prefijo sigue siendo una referencia válida (con dígitos, largo razonable),
 * se separa: ref = prefijo, y la palabra inicia la descripción.
 * Solo aplica a tokens largos (≥ 11): las referencias reales cortas nunca
 * se tocan.
 */
const PALABRAS_REPUESTO = [
  'MOTOVENTILADOR', 'AMORTIGUADOR', 'POTENCIOMETRO', 'RODAMIENTOS',
  'RODAMIENTO', 'INTERRUPTOR', 'TERMOSTATO', 'VENTILADOR',
  'MANGUERA', 'EMPAQUE', 'PASTILLAS', 'SOPORTE', 'VALVULA', 'RADIADOR',
  'INYECTOR', 'SENSOR', 'BOMBA', 'RETEN', 'BUJE', 'TENSOR', 'CORREA',
  'FILTRO', 'TAPA', 'BIELETA', 'PERA', 'AXIAL', 'MODULO', 'JUEGO',
  'BRIDA', 'BASE', 'MUÑECO', 'MUNECO', 'KIT',
];

function separarRefPegada(token: string): { ref: string; descInicial: string } | null {
  if (token.length < 11) return null;
  const upper = token.toUpperCase();
  for (const palabra of PALABRAS_REPUESTO) {
    if (!upper.endsWith(palabra)) continue;
    const prefijo = token.slice(0, token.length - palabra.length);
    if (prefijo.length >= 6 && /\d/.test(prefijo) && capturarRef(prefijo)) {
      return { ref: prefijo, descInicial: palabra };
    }
  }
  // I72: con códigos LARGOS World Office trunca al ancho de la columna y la
  // descripción queda pegada al recorte — p. ej. el código
  // 377959455/002-60-01988 sale como "377959455/00MOTOVENTILADOR" aunque la
  // palabra no esté en el diccionario. El token completo ya no cabe como
  // referencia (supera el largo máximo), así que se corta donde un dígito o
  // separador queda seguido de letras hasta el final; el prefijo queda como
  // referencia parcial y el cruce por prefijo (I60/I64) la completa.
  if (!REF_RE.test(token)) {
    const m = /^([A-Z0-9][A-Z0-9\-_./:]{4,19}[0-9/:.-])([A-ZÁÉÍÓÚÑ]{4,})$/i.exec(token);
    if (m && /\d/.test(m[1]) && capturarRef(m[1])) {
      return { ref: m[1].toUpperCase(), descInicial: m[2].toUpperCase() };
    }
  }
  return null;
}

/** Referencia + posible descripción pegada (I68), o null si no es ref. */
function capturarRefConDescripcion(
  token: string,
): { ref: string; descInicial: string } | null {
  // Primero el recorte de descripción pegada: el token largo completo puede
  // pasar REF_RE y quedarse con la descripción dentro — p. ej. ítem 32 de
  // FECV 3584: "1J0129684CGMANGUERA" debe quedar "1J0129684CG".
  const pegada = separarRefPegada(token);
  if (pegada) return pegada;
  const ref = capturarRef(token);
  return ref ? { ref, descInicial: '' } : null;
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
    empresaFactura: null,
    nitEmpresa: null,
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
      // valores en la línea siguiente (layout de dos líneas).
      // I74: la variante del registro de importación omite CIUDAD y agrega
      // PAÍS — "DIRECCION  TELEFONO  PAIS ORIGEN  PAIS COMPRA". Su fila de
      // valores (la dirección del proveedor) tampoco es un ítem: termina en
      // número ("RUA JOAO … EXT 2") y sin consumirla aquí salía como
      // producto con referencia "RUA" y cantidad 2.
      if (pendienteFilaDir) {
        pendienteFilaDir = false;
        this.aplicarFilaDireccion(linea, data, esquema.cabecera);
        previa = linea;
        continue; // la fila de valores de la dirección no es un ítem (I74)
      } else if (
        /^DIRECCI[OÓ]N\s{2,}(?:CIUDAD\s{2,})?TEL[EÉ]FONO/i.test(linea)
      ) {
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
   * I39: la continuación puede arrancar con el modelo/año ("2014 COFAP").
   */
  private esContinuacionDescripcion(l: string): boolean {
    const iniciaConAnio = /^\d{4}\s+[A-Za-zÁÉÍÓÚÑ(]/.test(l);
    // I74: la continuación puede arrancar con un número corto seguido de
    // texto — "16 VAL SCHADEK" (segunda línea de "…MEGANE 1.6 / 16 VAL…")
    const iniciaConNumeroCorto = /^\d{1,2}\s+[A-ZÁÉÍÓÚÑ]{2,}/.test(l);
    if (!/^[A-ZÁÉÍÓÚÑ(]/i.test(l) && !iniciaConAnio && !iniciaConNumeroCorto)
      return false;
    if (/\d{1,3}[.,]\d{3}/.test(l)) return false; // valores de miles
    if (!iniciaConAnio && /\d{3,}/.test(l)) return false; // CUFE, teléfonos, cuentas
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

    // I71 (facturas de compra): empresa emisora — nombre a la izquierda del
    // rótulo "FACTURA DE COMPRA" en el encabezado, y el primer NIT del
    // documento (el de la empresa; el del proveedor viene después).
    if (!data.empresaFactura && aplica('empresaFactura')) {
      const m = /^(.+?)\s{1,10}factura\s+de\s+compra\b/i.exec(l);
      if (m && m[1].trim().length >= 4 && !/^\s*nit\b/i.test(m[1])) {
        data.empresaFactura = m[1].trim();
      }
      // I74: registro de IMPORTACIÓN — la empresa va antes de la palabra
      // IMPORTACIÓN en el título y el folio cierra la línea:
      // "IMPORT - REPUESTOS EL ESCARABAJO IMPORTACION               233"
      if (!data.empresaFactura) {
        const imp = /^(.+?)\s+IMPORTACI[OÓ]N\s+\d{1,7}\s*$/i.exec(l);
        if (imp && imp[1].trim().length >= 4 && !/^\s*nit\b/i.test(imp[1])) {
          data.empresaFactura = imp[1].trim();
        }
      }
    }
    if (!data.nitEmpresa && aplica('nitEmpresa')) {
      const m = /^Nit\.?\s+([0-9][0-9.\-]{4,19})/i.exec(l);
      if (m) data.nitEmpresa = m[1].trim();
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
      // I39: fecha larga en español ("viernes, 24 de julio de 2026") — no
      // exige rótulo porque el formato es inequívoco
      const larga =
        /(\d{1,2})\s+de\s+([a-záéíóú]{3,10})\s+de\s+(\d{4})/i.exec(l);
      if (larga) {
        const mes = MESES_ES[larga[2].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')];
        if (mes) data.fecha = toIso(larga[1], String(mes), larga[3]);
      }
      // I26: la fecha ISO también exige contexto — "Vence 2027-07-13" del
      // encabezado DIAN no es la fecha de la factura
      if (!data.fecha && iso && /fecha|date|generaci|expedici|emisi/i.test(l)) {
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
        campo(/(?:proveedor|supplier|vendor|remitente)\s{2,}(\S(?:.+?))\s*(?=FECHA|VENDEDOR|FORMA|$)/i) ??
        // I39 (FCE): el rótulo puede venir truncado ("PROVEEDO") y con un
        // solo espacio — "PROVEEDO MAGNETI MARELLI   POR CONCEPTO DE"
        campo(/(?:^|\s)proveedo?r?\s+(\S(?:.*?))\s*(?:\s{2,}|\bPOR CONCEPTO\b(?:\s*DE)?|$)/i);
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
          // I68: el token puede traer la descripción pegada a la ref
          // ("1J0129684CGMANGUERA DE ADMINISION…")
          const sep = capturarRefConDescripcion(ref2);
          if (sep) {
            ref = sep.ref;
            resto = [[sep.descInicial, ...desc].filter(Boolean).join(' '), ...resto.slice(1)];
          }
        } else if (resto.length >= 2) {
          // I26: layout de columnas anchas — referencia y descripción quedan
          // en columnas separadas ("1   N1063   AXIAL R/L …   3,00  24.000  72.000")
          const sep = capturarRefConDescripcion(resto[0]);
          if (sep) {
            ref = sep.ref;
            resto = resto.slice(1);
            if (sep.descInicial) resto = [sep.descInicial, ...resto];
          }
        }
      } else if (partes.length >= 2) {
        // I68 (FECV de ICV): el número de ítem queda pegado a la referencia
        // con UN solo espacio ("39 39869  SENSOR…" o "23 056919081C PERA…"),
        // así que la división por columnas los deja en el mismo campo y el
        // ítem completo se perdía (salía como EXTRA sin referencia).
        const pegado = /^(\d{1,3})\s+(\S+)(?:\s+(.*))?$/.exec(partes[0]);
        if (pegado) {
          const sep = capturarRefConDescripcion(pegado[2]);
          if (sep) {
            ref = sep.ref;
            const cabeza = [sep.descInicial, pegado[3] ?? '']
              .filter(Boolean)
              .join(' ');
            resto = cabeza ? [cabeza, ...partes.slice(1)] : partes.slice(1);
          }
        }
        // I74 (IMPORTACIÓN con columna Código): cuando el código es más
        // ancho que la columna queda en la misma "columna" que la descripción
        // con un solo espacio — "10086/10094 BOMBA ACEITE CON TUBO …". Se
        // separa en el primer espacio; la guarda de dígitos evita confundir
        // la primera palabra de una descripción sin código (FCE) con una ref.
        if (ref === partes[0]) {
          const refDesc = /^(\S*\d\S*)\s+(.+)$/.exec(partes[0]);
          if (refDesc) {
            const sep = capturarRefConDescripcion(refDesc[1]);
            if (sep) {
              ref = sep.ref;
              const cabeza = [sep.descInicial, refDesc[2]]
                .filter(Boolean)
                .join(' ');
              resto = cabeza ? [cabeza, ...partes.slice(1)] : partes.slice(1);
            }
          }
        }
      }
      // I68: la referencia directa también puede traer descripción pegada
      const sepRef = capturarRefConDescripcion(ref);
      if (!sepRef) return this.parseLineaSinRef(linea);
      // I74: una "referencia" que es el inicio de una dirección postal
      // ("RUA …", "CALLE …") no es un ítem, aunque la línea cierre en número
      if (REF_DIRECCION_RE.test(sepRef.ref)) return null;
      if (sepRef.descInicial) {
        ref = sepRef.ref;
        resto = [sepRef.descInicial, ...resto];
      }
      // I22: en documentos de venta las columnas son …cantidad, valorUnitario,
      // valorTotal. La cantidad puede tener decimales ("4,00") y el patrón
      // monetario se la traga; por eso se extraen los números del FINAL de la
      // línea en orden: cantidad = primero, luego unitario y total.
      let textoResto = resto.join(' ');
      // I26 (ICV): layout con columna de unidad — "… 3  Und.  68.000 19%  10.982  204.000".
      // La cantidad va ANTES de la unidad; detrás van unitario, IVA% y total.
      // I71 (facturas de compra, p. ej. FC 1241): el mismo layout —
      // "… 5,00  Und.  51.113  19%  255.565" — pero los valores monetarios se
      // descartan y de la cantidad solo cuenta la parte entera (se truncan
      // los decimales, no se redondean).
      const idxUnidad = resto.findIndex((p) =>
        UNIDADES.includes(p.replace(/\./g, '').toUpperCase()),
      );
      if (idxUnidad > 0) {
        const antes = resto.slice(0, idxUnidad).join(' ');
        // I68: la descripción puede faltar por completo (quedó en la
        // columna del ítem); entonces lo que precede a la unidad es SOLO
        // la cantidad ("1" en "… | 1 | Und. | 87.000 19% | …").
        const mCant = /^(?:(.*?)\s+)?(\d{1,6}(?:[.,]\d{1,2})?)$/.exec(antes);
        if (mCant) {
          const bruto = Number(mCant[2].replace(',', '.'));
          const cantidad = conValor ? Math.round(bruto) : Math.trunc(bruto);
          if (cantidad > 0) {
            if (!conValor) {
              return {
                referencia: ref.toUpperCase(),
                descripcion: (mCant[1] ?? '').trim() || null,
                cantidad,
                unidad: 'UND',
              } as OcrItem;
            }
            const despues = resto.slice(idxUnidad + 1).join(' ');
            const nums = [
              ...despues.matchAll(
                /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+)/g,
              ),
            ].map((m) => Number(m[1].replace(/\./g, '').replace(',', '.')));
            return {
              referencia: ref.toUpperCase(),
              descripcion: (mCant[1] ?? '').trim() || null,
              cantidad,
              unidad: 'UND',
              valorUnitario: nums.length >= 2 ? nums[0] : null,
              valorTotal: nums.length ? nums[nums.length - 1] : null,
            } as OcrItem;
          }
        }
      }
      // I74 (registro de IMPORTACIÓN con columna Código, mismo ERP de la
      // FCE): la línea no tiene unidad y cierra con cola monetaria —
      // "… SCHADEK 150 41.687 0% 6.253.111". La cantidad es el entero que
      // precede a los valores; los valores monetarios se descartan.
      if (!conValor) {
        const imp = this.extraerCantidadImportacion(textoResto);
        if (imp) {
          return {
            referencia: ref.toUpperCase(),
            descripcion: imp.descripcion || null,
            cantidad: imp.cantidad,
            unidad: 'UND',
          } as OcrItem;
        }
      }
      if (conValor) {
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

    // I74: el formato IMPORTACIÓN con columnas colapsadas a un solo espacio
    // (Tesseract) — "62001 JGO BALANCINES CORSA 1400 X8 SCHADEK 150 41.687
    // 0% 6.253.111". Sin esta rama la línea plana no producía ítem alguno.
    if (!conValor) {
      const cabeza = /^([A-Z0-9][A-Z0-9\-_./:]{2,24})\s+(.+)$/.exec(linea);
      if (cabeza) {
        const sepRef = capturarRefConDescripcion(cabeza[1]);
        if (sepRef && !REF_DIRECCION_RE.test(sepRef.ref)) {
          const resto = [sepRef.descInicial, cabeza[2]]
            .filter(Boolean)
            .join(' ');
          const imp = this.extraerCantidadImportacion(resto);
          if (imp) {
            return {
              referencia: sepRef.ref.toUpperCase(),
              descripcion: imp.descripcion || null,
              cantidad: imp.cantidad,
              unidad: 'UND',
            } as OcrItem;
          }
        }
      }
    }

    // Línea plana: REF DESCRIPCION CANTIDAD [UNIDAD]
    const m =
      /^([A-Z0-9][A-Z0-9\-_./]{2,24})\s+(.+?)\s+(\d{1,6})(?:\s+([A-Z]{2,7}))?$/i.exec(linea);
    // I39: ítem "solo descripción" en texto plano (Tesseract colapsa las
    // columnas a un solo espacio)
    if (!m) return this.parseLineaSinRef(linea);
    const unidad = m[4] && UNIDADES.includes(m[4].toUpperCase()) ? m[4].toUpperCase() : m[4] ? null : 'UND';
    if (m[4] && unidad === null) {
      // La palabra final no es unidad conocida: la tratamos como parte de la descripción con cantidad ambigua → descartar
      return null;
    }
    const ref = m[1].toUpperCase();
    // Evitar falsos positivos de cabeceras (I26: lista ampliada de rótulos)
    if (ROTULOS_RE.test(ref) || /^(INVOICE|DATE|GUIA)$/i.test(ref)) return null;
    // I74: tampoco una línea de dirección ("RUA … EXT 2" salía como ítem)
    if (REF_DIRECCION_RE.test(ref)) return null;
    return {
      referencia: ref,
      descripcion: m[2].trim(),
      cantidad: parseInt(m[3], 10),
      unidad: unidad ?? 'UND',
    };
  }

  /**
   * I74: cantidad en el formato IMPORTACIÓN con columna Código —
   * "… DESCRIPCIÓN cantidad valorUnitario IVA% valorTotal" SIN unidad.
   * La cantidad es el entero que precede a los valores monetarios; un valor
   * monetario exige separador de miles o decimales para no confundir la
   * cantidad con dinero. El IVA% se descarta antes de medir la cola.
   * Ej.: "JGO BALANCINES CORSA 1400 X8 SCHADEK 150 41.687 0% 6.253.111"
   */
  private extraerCantidadImportacion(
    texto: string,
  ): { cantidad: number; descripcion: string } | null {
    const limpio = texto
      .replace(/\d+(?:[.,]\d+)?\s*%/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    const DINERO = String.raw`\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{2}`;
    const m = new RegExp(
      `^(.*?)\\s+(\\d{1,6})\\s+((?:${DINERO})(?:\\s+(?:${DINERO}))?)\\s*$`,
    ).exec(limpio);
    if (!m) return null;
    const descripcion = m[1].trim();
    if (descripcion.length < 3 || !/[A-ZÁÉÍÓÚÑ]{2,}/i.test(descripcion)) {
      return null;
    }
    const cantidad = parseInt(m[2], 10);
    if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
    return { cantidad, descripcion };
  }

  /**
   * I39: ítem SIN columna de referencia — "descripción + cantidad + unidad +
   * valores". Formato de las facturas de compra extranjera (FCE) de
   * proveedores como Magneti Marelli / COFAP:
   *   AMORTIGUADOR TRAS GOLF3 CON PLATO COFAP   92 Und.   12.877   0%   1.184.706
   * Tolera la cantidad pegada a la unidad ("92Und.") y el IVA% intermedio.
   * La referencia queda vacía: el flujo de ingreso cruza por descripción o
   * genera una provisional para corrección.
   */
  private parseLineaSinRef(linea: string): OcrItem | null {
    const m =
      /^(.+?)\s+(\d{1,6})\s*(UNIDAD(?:ES)?|UND|UN|PCS|PZA|CAJA|CJ|PAR|JGO|KIT|LT|KG)\.?(?=\s|$)(.*)$/i.exec(
        linea,
      );
    if (!m) return null;
    const descripcion = m[1].trim();
    // La descripción debe ser texto real (varias letras), no cifras sueltas
    if (descripcion.length < 4 || !/[A-ZÁÉÍÓÚÑ]{3,}/i.test(descripcion)) return null;
    const cantidad = Math.round(Number(m[2]));
    if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
    const unidadRaw = m[3].toUpperCase();
    const unidad = ['UN', 'UND', 'UNIDAD', 'UNIDADES'].includes(unidadRaw)
      ? 'UND'
      : unidadRaw;
    // Cola de valores: unitario, IVA% (se descarta) y total
    const colaLimpia = (m[4] ?? '').replace(/\d+(?:[.,]\d+)?\s*%/g, ' ');
    const nums = [
      ...colaLimpia.matchAll(
        /(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+[.,]\d{1,2}|\d+)/g,
      ),
    ].map((x) => Number(x[1].replace(/\./g, '').replace(',', '.')));
    if (!nums.length) return null;
    return {
      referencia: '',
      descripcion,
      cantidad,
      unidad,
      valorUnitario: nums.length >= 2 ? nums[0] : null,
      valorTotal: nums[nums.length - 1],
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
    // I22: cantidad con decimales de factura ("4,00") → entero.
    // I71: en las facturas de compra los decimales se DESCARTAN (se trunca,
    // no se redondea): solo cuenta el número entero.
    const cantidad = Math.trunc(Number(m[2].replace(',', '.')));
    return { cantidad, unidad, descripcion };
  }
}
