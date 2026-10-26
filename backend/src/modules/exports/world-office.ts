/**
 * I51/I52/I62: exportación de pedidos a World Office (WO) — Asistente de
 * Importación / Migración de Documentos con Movimiento de Inventario.
 *
 * Lógica pura (sin NestJS ni TypeORM) para facilitar las pruebas unitarias:
 * - Configuración POR EMPRESA en system_params clave `wo.export.<SIGLAS>`
 *   (I62: tipo doc, bodega, unidad, forma de pago, vencimiento e IVA se
 *   parametrizan aparte para cada empresa). La clave histórica `wo.export`
 *   (global, I52) queda como respaldo mientras exista.
 * - Consecutivo POR EMPRESA en `wo.consecutivo.<SIGLAS>`.
 * - Datos que ya están en la base y NO son parámetros: nombre de la empresa
 *   emisora (companies), NIT del vendedor (comerciales.identificacion del
 *   pedido), NIT del cliente (clients.identificacion) y nota (orders.notas).
 * - Construcción del CSV plano de 57 columnas (encabezado repetido por ítem),
 *   replicando el archivo validado como exitoso en WO (sin BOM, dd/mm/yyyy,
 *   IVA decimal, valores sin separador de miles).
 */

/** Clave del parámetro global histórico (I52) — solo respaldo desde I62. */
export const WO_PARAM_GLOBAL = 'wo.export';
/** Prefijo de la clave de configuración WO por empresa (I62). */
export const WO_CONFIG_PREFIX = 'wo.export.';
/** Prefijo de la clave del consecutivo WO por empresa. */
export const WO_CONSECUTIVO_PREFIX = 'wo.consecutivo.';

/** Clave de la configuración WO de una empresa (p. ej. `wo.export.IRE`). */
export function woClaveConfig(siglas: string): string {
  return `${WO_CONFIG_PREFIX}${siglas}`;
}

/** I62: resuelve la config de la empresa con respaldo en la global histórica. */
export function resolverConfigWo(
  filaEmpresa: { valor: WoConfig } | undefined,
  filaGlobal: { valor: WoConfig } | undefined,
  claveEmpresa: string,
): { config: WoConfig | null; claveUsada: string } {
  if (filaEmpresa?.valor) return { config: filaEmpresa.valor, claveUsada: claveEmpresa };
  if (filaGlobal?.valor) return { config: filaGlobal.valor, claveUsada: WO_PARAM_GLOBAL };
  return { config: null, claveUsada: claveEmpresa };
}

/** Configuración WO global (jsonb en system_params, clave `wo.export`). */
export interface WoConfig {
  /** Abreviatura del documento en WO (COT = cotización, PD = pedido). */
  tipoDocumento: string;
  /** Prefijo del documento en WO (vacío si no maneja). */
  prefijo: string;
  /** Bodega contable (ej. Principal). */
  bodegaDefault: string;
  /** Unidad de medida en WO (ej. Und.). */
  unidadMedida: string;
  /** Forma de pago según maestros WO (ej. Credito 30 DIAS). */
  formaPagoDefault: string;
  /** Días de crédito para la fecha de vencimiento de cada ítem. */
  diasVencimiento: number;
  /** IVA decimal aplicado a los ítems (0.19 = 19%). */
  iva: number;
}

export function woConfigPorDefecto(): WoConfig {
  return {
    tipoDocumento: 'COT',
    prefijo: '',
    bodegaDefault: 'Principal',
    unidadMedida: 'Und.',
    formaPagoDefault: 'Credito 30 DIAS',
    diasVencimiento: 30,
    iva: 0.19,
  };
}

/** Las 57 columnas exactas del parser de WO (orden estricto). */
export const COLUMNAS_WO: string[] = [
  'Encabezados: Empresa',
  'Encabezados: Tipo Documento',
  'Encabezados: Prefijo',
  'Encabezados: Documento Número',
  'Encabezados: Fecha',
  'Encabezados: Tercero Interno',
  'Encabezados: Tercero Externo',
  'Encabezados: Nota',
  'Encabezados: FormaPago',
  'Encabezados: Fecha Entrega',
  'Encabezados: Prefijo Documento Externo',
  'Encabezados: Número_Documento_Externo',
  'Encabezados: Verificado',
  'Encabezados: Anulado',
  ...Array.from({ length: 15 }, (_, i) => `Encabezados: Personalizado ${i + 1}`),
  'Encabezados: Sucursal',
  'Encabezados: Clasificación',
  'Detalle: Producto',
  'Detalle: Bodega',
  'Detalle: UnidadDeMedida',
  'Detalle: Cantidad',
  'Detalle: IVA',
  'Detalle: Valor Unitario',
  'Detalle: Descuento',
  'Detalle: Vencimiento',
  'Detalle: Nota',
  'Detalle: Centro costos',
  ...Array.from({ length: 15 }, (_, i) => `Detalle: Personalizado${i + 1}`),
  'Detalle: Código Centro Costos',
];

/** Pedido con los datos necesarios para validar y exportar. */
export interface WoPedidoInput {
  id: string;
  numero: string;
  estado: string;
  notas: string | null;
  createdAt: Date;
  exportadoWo: boolean;
  woDocumentoNumero: number | null;
  clienteIdentificacion: string | null;
  comercialIdentificacion: string | null;
  items: Array<{
    codigo: string | null;
    descripcion: string | null;
    cantidad: number | string;
    valorUnidad: number | string;
  }>;
}

export interface WoProblema {
  pedidoId: string | null;
  numero: string | null;
  mensaje: string;
}

export interface WoPreflight {
  ok: boolean;
  errores: WoProblema[];
  advertencias: WoProblema[];
  resumen: {
    pedidos: number;
    lineas: number;
    documentoDesde: number | null;
    documentoHasta: number | null;
  };
}

/** Solo dígitos: elimina prefijos (CC, NIT), espacios, puntos y guiones. */
export function soloDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D+/g, '');
}

/**
 * Identificación del cliente para el Tercero Externo: solo números, y
 * cuando el texto trae "NIT" se elimina el último dígito (el dígito de
 * verificación): "NIT 901689082 1" → "901689082".
 */
export function nitClienteWo(v: string | null | undefined): string {
  const digitos = soloDigitos(v);
  if (/nit/i.test(v ?? '') && digitos.length > 1) {
    return digitos.slice(0, -1);
  }
  return digitos;
}

/** dd/mm/yyyy en zona America/Bogota; diasExtra suma días calendario. */
export function fechaWo(fecha: Date, diasExtra = 0): string {
  const base = new Date(fecha.getTime() + diasExtra * 86_400_000);
  const partes = new Intl.DateTimeFormat('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(base);
  const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')}`;
}

/** Número plano sin separador de miles ni decimales de relleno (25210, 0.19). */
export function numeroWo(v: number | string): string {
  return String(Number(v));
}

/** Escape CSV estándar: comillas dobles si trae coma, comillas o salto. */
export function csvEscapeWo(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const VACIOS_15 = Array(15).fill('');
// Versión con celdas realmente vacías para el .xlsx (como el archivo WO)
const VACIOS_15_NULL = Array(15).fill(null);

/**
 * Validación previa a la exportación. Errores bloquean la generación del
 * archivo; las advertencias se muestran pero permiten continuar.
 */
export function validarExportacionWo(args: {
  config: WoConfig | null;
  /** I62: clave del parámetro donde debe vivir la config (wo.export.<SIGLAS>). */
  claveConfig: string;
  empresaNombre: string | null;
  consecutivoActual: number | null;
  claveConsecutivo: string;
  pedidos: WoPedidoInput[];
  idsNoEncontrados: string[];
  empresasMezcladas: boolean;
}): WoPreflight {
  const {
    config, claveConfig, empresaNombre, consecutivoActual, claveConsecutivo,
    pedidos, idsNoEncontrados, empresasMezcladas,
  } = args;
  const errores: WoProblema[] = [];
  const advertencias: WoProblema[] = [];
  const global = (mensaje: string) =>
    errores.push({ pedidoId: null, numero: null, mensaje });

  if (empresasMezcladas) {
    global('Todos los pedidos de una exportación deben ser de la misma empresa');
  }
  if (!config) {
    global(
      `No existe la configuración de World Office de la empresa (parámetro ${claveConfig}). ` +
        'Créela en Administración → Parámetros.',
    );
  } else if (!config.tipoDocumento?.trim()) {
    global(`Falta el tipo de documento WO (${claveConfig} → tipoDocumento)`);
  }
  if (!empresaNombre?.trim()) {
    global('La empresa no tiene nombre (Empresa / Razón social emisora del pedido)');
  }
  if (
    consecutivoActual === null ||
    !Number.isInteger(consecutivoActual) ||
    consecutivoActual < 0
  ) {
    global(
      `El consecutivo WO es inválido o no existe (${claveConsecutivo} → consecutivoActual debe ser entero ≥ 0)`,
    );
  }
  for (const id of idsNoEncontrados) {
    errores.push({
      pedidoId: id,
      numero: null,
      mensaje: 'El pedido no existe',
    });
  }

  for (const p of pedidos) {
    const err = (mensaje: string) =>
      errores.push({ pedidoId: p.id, numero: p.numero, mensaje });
    const adv = (mensaje: string) =>
      advertencias.push({ pedidoId: p.id, numero: p.numero, mensaje });

    if (p.estado !== 'ALISTADO') {
      err(`Solo se exportan pedidos ALISTADOS (estado actual: ${p.estado})`);
    }
    if (!nitClienteWo(p.clienteIdentificacion)) {
      err('El cliente no tiene identificación (NIT/cédula) válida');
    }
    if (!soloDigitos(p.comercialIdentificacion)) {
      err('El pedido no tiene comercial con identificación válida');
    }
    if (p.items.length === 0) err('El pedido no tiene ítems');
    for (const it of p.items) {
      if (!it.codigo?.trim()) {
        err('Hay ítems sin código de producto');
        break;
      }
    }
    if (p.items.some((it) => Number(it.valorUnidad) === 0)) {
      adv('Hay ítems con valor unitario en cero');
    }
    if (p.exportadoWo) {
      adv(
        `Ya fue exportado a WO; conservará el documento ${p.woDocumentoNumero} ya asignado`,
      );
    }
  }

  // Solo los pedidos NUEVOS consumen consecutivo; los ya exportados
  // conservan el número de documento WO que se les asignó (idempotencia).
  const nuevos = pedidos.filter((p) => !p.exportadoWo).length;
  const consecutivoValido =
    consecutivoActual !== null &&
    Number.isInteger(consecutivoActual) &&
    consecutivoActual >= 0;
  return {
    ok: errores.length === 0,
    errores,
    advertencias,
    resumen: {
      pedidos: pedidos.length,
      lineas: pedidos.reduce((acc, p) => acc + p.items.length, 0),
      documentoDesde: consecutivoValido && nuevos > 0 ? consecutivoActual! + 1 : null,
      documentoHasta: consecutivoValido && nuevos > 0 ? consecutivoActual! + nuevos : null,
    },
  };
}

/**
 * Construye las líneas de datos del CSV (una por ítem, con el encabezado del
 * documento repetido). `numerosWo` asigna a cada pedido su número de
 * documento WO (consecutivo de la empresa o el ya asignado).
 */
export function construirLineasWo(args: {
  config: WoConfig;
  empresaNombre: string;
  pedidos: WoPedidoInput[];
  numerosWo: Map<string, number>;
}): string[] {
  const { config, empresaNombre, pedidos, numerosWo } = args;
  const lineas: string[] = [];

  for (const p of pedidos) {
    const docNumero = numerosWo.get(p.id)!;
    const fecha = fechaWo(p.createdAt);
    const vencimiento = fechaWo(p.createdAt, config.diasVencimiento || 0);
    const encabezado: string[] = [
      empresaNombre,
      config.tipoDocumento,
      config.prefijo ?? '',
      String(docNumero),
      fecha,
      soloDigitos(p.comercialIdentificacion), // Tercero Interno: NIT del vendedor
      nitClienteWo(p.clienteIdentificacion), // Tercero Externo: NIT del cliente
      p.notas?.trim() || `PEDIDO SOFIA #${p.numero}`, // Nota: observaciones del pedido
      config.formaPagoDefault,
      fecha, // Fecha Entrega: por defecto la misma del pedido
      '', // Prefijo Documento Externo (vacío, como el archivo validado)
      String(docNumero), // Número Documento Externo = consecutivo WO
      '0', // Verificado
      '0', // Anulado
      ...VACIOS_15, // Personalizados 1-15
      '', // Sucursal
      '', // Clasificación
    ];
    for (const it of p.items) {
      const detalle: string[] = [
        it.codigo ?? '',
        config.bodegaDefault,
        config.unidadMedida,
        numeroWo(it.cantidad),
        numeroWo(config.iva),
        numeroWo(it.valorUnidad),
        '0', // Descuento
        vencimiento,
        it.descripcion ?? '',
        '', // Centro costos
        ...VACIOS_15, // Personalizados 1-15
        '', // Código Centro Costos
      ];
      lineas.push(
        [...encabezado, ...detalle].map(csvEscapeWo).join(','),
      );
    }
  }
  return lineas;
}

/** CSV completo: encabezado de columnas + líneas. Sin BOM (como el archivo validado en WO). */
export function construirCsvWo(args: {
  config: WoConfig;
  empresaNombre: string;
  pedidos: WoPedidoInput[];
  numerosWo: Map<string, number>;
}): string {
  return [
    COLUMNAS_WO.join(','),
    ...construirLineasWo(args),
  ].join('\n');
}

/**
 * I53: libro .xlsx en el formato que espera World Office (validado con
 * WO_Prueba_3500.xlsx): hoja nombrada con las siglas de la empresa, encabezado
 * en negrilla con relleno azul claro (FF99CCFF), textos como texto y números
 * (documento, cantidades, IVA, valores) como números reales, fechas dd/mm/yyyy
 * como texto. Se genera con ExcelJS porque SheetJS Community no escribe
 * estilos de celda en el .xlsx.
 */
export async function construirXlsxWo(args: {
  config: WoConfig;
  empresaNombre: string;
  siglas: string;
  pedidos: WoPedidoInput[];
  numerosWo: Map<string, number>;
}): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ExcelJS = require('exceljs');
  const { config, empresaNombre, pedidos, numerosWo } = args;

  const wb = new ExcelJS.Workbook();
  // La hoja se nombra con las siglas de la empresa (IRE/ICV), como en WO
  const ws = wb.addWorksheet(args.siglas || 'WO');
  ws.columns = COLUMNAS_WO.map((h) => ({
    width: Math.min(h.length + 2, 36),
  }));

  // Encabezado: negrilla + relleno azul claro (FF99CCFF), como el archivo WO
  ws.addRow(COLUMNAS_WO);
  const filaEncabezado = ws.getRow(1);
  filaEncabezado.font = { bold: true };
  filaEncabezado.eachCell((cell: any) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF99CCFF' },
    };
  });

  for (const p of pedidos) {
    const docNumero = numerosWo.get(p.id)!;
    const fecha = fechaWo(p.createdAt);
    const vencimiento = fechaWo(p.createdAt, config.diasVencimiento || 0);
    // Réplica del script de transformación validado en WO: solo 8 columnas
    // llevan número real (Documento Número, Número_Documento_Externo,
    // Verificado, Anulado, Cantidad, IVA, Valor Unitario y Descuento) y TODA
    // celda sin dato queda realmente vacía (null) — nunca "" — y sin
    // formatos de columna. Así, Sucursal, Clasificación, Centro costos,
    // Personalizado1..15 y Código Centro Costos quedan en formato General
    // y vacías, exactamente como los "Personalizado" del archivo exitoso.
    const encabezado: any[] = [
      empresaNombre,
      config.tipoDocumento,
      config.prefijo || null, // Encabezados: Prefijo: vacío si no aplica
      docNumero, // Documento Número: numérico
      fecha, // dd/mm/yyyy como texto
      soloDigitos(p.comercialIdentificacion),
      nitClienteWo(p.clienteIdentificacion),
      p.notas?.trim() || `PEDIDO SOFIA #${p.numero}`,
      config.formaPagoDefault,
      fecha,
      null, // Prefijo Documento Externo: vacío
      docNumero, // Número Documento Externo: numérico
      0, // Verificado
      0, // Anulado
      ...VACIOS_15_NULL, // Encabezados: Personalizado 1..15: vacías
      null, // Encabezados: Sucursal: vacía
      null, // Encabezados: Clasificación: vacía
    ];
    for (const it of p.items) {
      const detalle: any[] = [
        it.codigo ?? '',
        config.bodegaDefault,
        config.unidadMedida,
        Number(it.cantidad),
        Number(config.iva),
        Number(it.valorUnidad),
        0, // Descuento
        vencimiento,
        it.descripcion ?? '',
        null, // Detalle: Centro costos: vacío
        ...VACIOS_15_NULL, // Detalle: Personalizado1..15: vacíos
        null, // Detalle: Código Centro Costos: vacío
      ];
      ws.addRow([...encabezado, ...detalle]);
    }
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}
