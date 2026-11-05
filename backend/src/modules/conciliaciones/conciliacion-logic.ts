/**
 * I65h — Conciliación de productos World Office vs. SofIA (lógica pura).
 *
 * El archivo de WO (Excel/CSV) se parsea con el ImportParserService y cada
 * columna se mapea a un campo comparable. Siempre se comparan las columnas
 * mapeadas; existencia y precio son las de mayor interés, pero cualquier
 * otro campo asociado (descripción, marca, unidad, código OE) también se
 * compara y reporta.
 */

/** Campos destino comparables en la conciliación (codigo es la llave). */
export const CAMPOS_CONCILIACION = {
  llave: 'codigo',
  comparables: [
    'existencia',
    'precio',
    'descripcion',
    'marca',
    'unidad_medida',
    'codigo_oe',
  ] as const,
};

export type CampoComparable = (typeof CAMPOS_CONCILIACION.comparables)[number];

export const ETIQUETAS_CAMPO: Record<string, string> = {
  codigo: 'Código',
  existencia: 'Existencia',
  precio: 'Precio',
  descripcion: 'Descripción',
  marca: 'Marca',
  unidad_medida: 'Unidad de medida',
  codigo_oe: 'Código OE',
};

export interface ProductoSofia {
  codigo: string;
  descripcion: string | null;
  marca: string | null;
  unidadMedida: string | null;
  codigoOE: string | null;
  cantidad: number;
  precio: number | string;
}

export interface DiferenciaCampo {
  campo: CampoComparable;
  valorWo: string;
  valorSofia: string;
}

export type EstadoFila =
  | 'COINCIDE'
  | 'DIFERENCIA'
  | 'NO_ENCONTRADO_EN_SOFIA'
  | 'FALTANTE_EN_WO';

export interface FilaConciliacion {
  codigo: string;
  estado: EstadoFila;
  diferencias: DiferenciaCampo[];
}

export interface ResultadoConciliacion {
  filas: FilaConciliacion[];
  totalArchivo: number;
  coinciden: number;
  conDiferencias: number;
  noEncontrados: number;
  faltantesEnWo: number;
}

/** Normaliza texto para comparar (sin mayúsculas, espacios ni tildes). */
export function normalizarTexto(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

/** Código normalizado para cruzar (solo letras y dígitos, I60). */
export function normalizarCodigo(v: string | null | undefined): string {
  return normalizarTexto(v).replace(/[^A-Z0-9]+/g, '');
}

/**
 * Número de WO en formato colombiano: "1.234.567,89" | "650.000" | "2,00"
 * | "1234.56". Enteros con solo puntos se tratan como miles; una sola coma
 * con 1-2 dígitos tras ella es decimal.
 */
export function parseNumeroWo(v: string | null | undefined): number | null {
  const limpio = (v ?? '').trim().replace(/[$\s]/g, '');
  if (!limpio) return null;
  let canon = limpio;
  if (limpio.includes(',') && limpio.includes('.')) {
    // 1.234.567,89 → 1234567.89
    canon = limpio.replace(/\./g, '').replace(',', '.');
  } else if (limpio.includes(',')) {
    canon = limpio.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpio)) {
    // 650.000 → 650000 (miles colombiano)
    canon = limpio.replace(/\./g, '');
  }
  const n = Number(canon);
  return Number.isFinite(n) ? n : null;
}

/** Compara dos valores monetarios con tolerancia de centavo. */
export function mismoPrecio(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * Cruza las filas del archivo WO con los productos SofIA de una empresa.
 * `filasWo` ya viene con destinos mapeados: { codigo, existencia?, precio?, ... }.
 */
export function conciliar(
  filasWo: Record<string, string>[],
  productos: ProductoSofia[],
  camposMapeados: CampoComparable[],
): ResultadoConciliacion {
  const porCodigo = new Map<string, ProductoSofia>();
  const porNormalizado = new Map<string, ProductoSofia>();
  for (const p of productos) {
    porCodigo.set(normalizarTexto(p.codigo), p);
    const norm = normalizarCodigo(p.codigo);
    if (norm && !porNormalizado.has(norm)) porNormalizado.set(norm, p);
  }

  const vistos = new Set<string>();
  const filas: FilaConciliacion[] = [];

  for (const fila of filasWo) {
    const codigoWo = (fila.codigo ?? '').trim();
    if (!codigoWo) continue;
    const producto =
      porCodigo.get(normalizarTexto(codigoWo)) ??
      porNormalizado.get(normalizarCodigo(codigoWo));
    if (!producto) {
      filas.push({ codigo: codigoWo, estado: 'NO_ENCONTRADO_EN_SOFIA', diferencias: [] });
      continue;
    }
    vistos.add(normalizarTexto(producto.codigo));

    const diferencias: DiferenciaCampo[] = [];
    for (const campo of camposMapeados) {
      const valorWo = (fila[campo] ?? '').trim();
      if (campo === 'existencia') {
        const n = parseNumeroWo(valorWo);
        if (n === null) continue;
        if (n !== producto.cantidad) {
          diferencias.push({
            campo,
            valorWo,
            valorSofia: String(producto.cantidad),
          });
        }
      } else if (campo === 'precio') {
        const n = parseNumeroWo(valorWo);
        if (n === null) continue;
        const precioSofia = Number(producto.precio);
        if (!mismoPrecio(n, precioSofia)) {
          diferencias.push({ campo, valorWo, valorSofia: String(precioSofia) });
        }
      } else {
        const sofia =
          campo === 'descripcion'
            ? producto.descripcion
            : campo === 'marca'
              ? producto.marca
              : campo === 'unidad_medida'
                ? producto.unidadMedida
                : producto.codigoOE;
        if (valorWo && normalizarTexto(valorWo) !== normalizarTexto(sofia)) {
          diferencias.push({ campo, valorWo, valorSofia: sofia ?? '' });
        }
      }
    }
    filas.push({
      codigo: producto.codigo,
      estado: diferencias.length ? 'DIFERENCIA' : 'COINCIDE',
      diferencias,
    });
  }

  // Productos SofIA con existencia o precio que no vinieron en el archivo WO
  for (const p of productos) {
    if (vistos.has(normalizarTexto(p.codigo))) continue;
    if (p.cantidad !== 0 || Number(p.precio) !== 0) {
      filas.push({
        codigo: p.codigo,
        estado: 'FALTANTE_EN_WO',
        diferencias: [
          { campo: 'existencia', valorWo: '', valorSofia: String(p.cantidad) },
        ],
      });
    }
  }

  return {
    filas,
    totalArchivo: filasWo.filter((f) => (f.codigo ?? '').trim()).length,
    coinciden: filas.filter((f) => f.estado === 'COINCIDE').length,
    conDiferencias: filas.filter((f) => f.estado === 'DIFERENCIA').length,
    noEncontrados: filas.filter((f) => f.estado === 'NO_ENCONTRADO_EN_SOFIA').length,
    faltantesEnWo: filas.filter((f) => f.estado === 'FALTANTE_EN_WO').length,
  };
}
