/**
 * I51/I52: exportación de pedidos a World Office (WO) — Asistente de
 * Importación / Migración de Documentos con Movimiento de Inventario.
 *
 * Lógica pura (sin NestJS ni TypeORM) para facilitar las pruebas unitarias:
 * - Configuración GLOBAL en system_params clave `wo.export` (aplica a todas
 *   las empresas: tipo doc, bodega, unidad, forma de pago, vencimiento, IVA).
 * - Consecutivo POR EMPRESA en `wo.consecutivo.<SIGLAS>`.
 * - Datos que ya están en la base y NO son parámetros: nombre de la empresa
 *   emisora (companies), NIT del vendedor (comerciales.identificacion del
 *   pedido), NIT del cliente (clients.identificacion) y nota (orders.notas).
 * - Construcción del CSV plano de 57 columnas (encabezado repetido por ítem),
 *   replicando el archivo validado como exitoso en WO (sin BOM, dd/mm/yyyy,
 *   IVA decimal, valores sin separador de miles).
 */

/** Clave del parámetro global de exportación WO. */
export const WO_PARAM_GLOBAL = 'wo.export';
/** Prefijo de la clave del consecutivo WO por empresa. */
export const WO_CONSECUTIVO_PREFIX = 'wo.consecutivo.';

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

/**
 * Validación previa a la exportación. Errores bloquean la generación del
 * archivo; las advertencias se muestran pero permiten continuar.
 */
export function validarExportacionWo(args: {
  config: WoConfig | null;
  empresaNombre: string | null;
  consecutivoActual: number | null;
  claveConsecutivo: string;
  pedidos: WoPedidoInput[];
  idsNoEncontrados: string[];
  empresasMezcladas: boolean;
}): WoPreflight {
  const {
    config, empresaNombre, consecutivoActual, claveConsecutivo,
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
      `No existe la configuración de World Office (parámetro ${WO_PARAM_GLOBAL}). ` +
        'Créela en Administración → Parámetros.',
    );
  } else if (!config.tipoDocumento?.trim()) {
    global(`Falta el tipo de documento WO (${WO_PARAM_GLOBAL} → tipoDocumento)`);
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
