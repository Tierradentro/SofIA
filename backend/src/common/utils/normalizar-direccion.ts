/**
 * I20: normalización de direcciones para detección de duplicados en la
 * importación de clientes. La igualdad exacta de texto dejaba pasar
 * "casi-duplicados" ("Calle 10 # 5-20" vs "calle 10 #5-20" vs
 * "Cra. 10 # 5-20" vs "Carrera 10 5 20"), que se acumulaban como
 * direcciones redundantes del mismo cliente.
 *
 * Estrategia en dos capas:
 *  1. Clave normalizada: minúsculas, sin puntuación (# . , - /), espacios
 *     colapsados y abreviaturas frecuentes de Colombia expandidas
 *     (cra/cr → carrera, cl → calle, av → avenida, dg → diagonal,
 *     tr → transversal, no/nro → numero).
 *     "numero" se descarta tras expandir: su equivalente "#" ya se quitó
 *     como puntuación, así "Calle 10 # 5-20" y "Calle 10 No. 5-20"
 *     deben converger a la misma clave.
 *  2. Similitud de trigramas (dice coefficient) con umbral 0.75 para
 *     capturar variaciones que la clave no cubre (abreviaturas no
 *     catalogadas, errores de tipeo). La similitud solo se aplica si los
 *     números de ambas direcciones coinciden: en direcciones cortas dos
 *     textos que solo difieren en un número ("...5-20" vs "...5-88",
 *     "Oficina 402" vs "403") superan cualquier umbral razonable y son
 *     direcciones DISTINTAS — el guardia numérico evita esos falsos
 *     positivos.
 */

const ABREVIATURAS: Record<string, string> = {
  cra: 'carrera',
  cr: 'carrera',
  cl: 'calle',
  av: 'avenida',
  ak: 'avenida carrera',
  ac: 'avenida calle',
  dg: 'diagonal',
  tr: 'transversal',
  tv: 'transversal',
  no: 'numero',
  nro: 'numero',
  num: 'numero',
  apto: 'apartamento',
  ap: 'apartamento',
  mz: 'manzana',
  lt: 'lote',
  cs: 'casa',
  bl: 'bloque',
  of: 'oficina',
  lc: 'local',
  int: 'interior',
  pq: 'parque',
  urb: 'urbanizacion',
};

/** Texto → forma canónica comparable (sin tildes, puntuación ni abreviaturas). */
export function normalizarDireccion(v?: string | null): string {
  let t = (v ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sin tildes
    .replace(/[#.,\-/()°º]/g, ' ') // puntuación frecuente en direcciones
    .replace(/\s+/g, ' ')
    .trim();
  const tokens = t
    .split(' ')
    .map((tok) => ABREVIATURAS[tok] ?? tok)
    .join(' ')
    .split(' ')
    .filter((tok) => tok && tok !== 'numero') // "#" ya se eliminó; su alias también
    .map((tok) =>
      // Tipeo frecuente: la letra "o" por el dígito 0 ("128-3O").
      /^\d*[o]+\d*$/.test(tok) && /\d/.test(tok) ? tok.replace(/o/g, '0') : tok,
    );
  return tokens.join(' ').replace(/\s+/g, ' ').trim();
}

/** Números de la dirección normalizada, ordenados (guardia anti falsos positivos). */
function numerosDe(normalizada: string): string[] {
  return normalizada
    .split(' ')
    .filter((tok) => /^\d+$/.test(tok))
    .sort();
}

/** Clave de igualdad estricta tras normalización (dirección + ciudad). */
export function claveDireccion(
  direccion?: string | null,
  ciudad?: string | null,
): string {
  return `${normalizarDireccion(direccion)}|${normalizarDireccion(ciudad)}`;
}

function trigramas(t: string): Set<string> {
  const padded = ` ${t} `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    set.add(padded.slice(i, i + 3));
  }
  return set;
}

/** Coeficiente de Sørensen–Dice sobre trigramas (0..1). */
export function similitudDireccion(a: string, b: string): number {
  if (!a || !b) return a === b ? 1 : 0;
  if (a === b) return 1;
  const ta = trigramas(a);
  const tb = trigramas(b);
  let interseccion = 0;
  for (const g of ta) if (tb.has(g)) interseccion++;
  return (2 * interseccion) / (ta.size + tb.size);
}

/**
 * Umbral de similitud para considerar dos direcciones la misma. Va de la
 * mano del guardia numérico de `direccionDuplicada`: 0.75 admite un tipeo
 * en la parte textual ("carerra" por "carrera" ≈ 0.80) sin llegar a
 * confundir tipos de vía distintos ("calle" vs "carrera" ≈ 0.57).
 */
export const UMBRAL_SIMILITUD_DIRECCION = 0.75;

/**
 * ¿La dirección ya existe entre las conocidas? Primero clave exacta
 * (barata); si no, similitud contra cada una.
 */
export function direccionDuplicada(
  direccion: string | null | undefined,
  ciudad: string | null | undefined,
  conocidas: Set<string>,
): boolean {
  const clave = claveDireccion(direccion, ciudad);
  if (conocidas.has(clave)) return true;
  const normalizada = normalizarDireccion(direccion);
  if (!normalizada) return false;
  const normCiudad = normalizarDireccion(ciudad);
  const numeros = numerosDe(normalizada);
  for (const k of conocidas) {
    const sep = k.lastIndexOf('|');
    const otraDir = k.slice(0, sep);
    const otraCiudad = k.slice(sep + 1);
    if (otraCiudad !== normCiudad) continue;
    // Guardia numérico: si ambas traen números y difieren, son direcciones
    // distintas aunque el texto sea casi igual ("Oficina 402" vs "403").
    const otrosNumeros = numerosDe(otraDir);
    if (
      numeros.length > 0 &&
      otrosNumeros.length > 0 &&
      numeros.join(',') !== otrosNumeros.join(',')
    ) {
      continue;
    }
    if (similitudDireccion(normalizada, otraDir) >= UMBRAL_SIMILITUD_DIRECCION) {
      return true;
    }
  }
  return false;
}
