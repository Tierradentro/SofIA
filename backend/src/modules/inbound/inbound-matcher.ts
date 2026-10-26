import { Product } from '../products/entities/product.entity';

export interface MatchResult {
  producto: Product | null;
  criterio:
    | 'CODIGO'
    | 'CODIGO_OE'
    | 'REF_CRUZADA_1'
    | 'REF_CRUZADA_2'
    | 'BARCODE'
    | 'DESCRIPCION'
    | 'CODIGO_PARCIAL'
    | 'CODIGO_PARCIAL_DESCRIPCION'
    | 'DESCRIPCION_PARCIAL'
    | null;
}

/**
 * Matching de referencias del documento contra productos de la empresa
 * (regla M07/M08): código propio primero, luego código OE, referencias
 * cruzadas 1 y 2, y finalmente código de barras. Todo dentro de la empresa
 * del ingreso (multiempresa enforceado en backend).
 */
export class InboundMatcher {
  constructor(
    private readonly productos: Product[],
    private readonly barcodeToProductId: Map<string, string>,
  ) {}

  match(referencia: string): MatchResult {
    const ref = referencia.trim().toUpperCase();
    if (!ref) return { producto: null, criterio: null };
    const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

    const por = (campo: (p: Product) => string | null | undefined) =>
      this.productos.find((p) => norm(campo(p)) === ref) ?? null;

    const codigo = por((p) => p.codigo);
    if (codigo) return { producto: codigo, criterio: 'CODIGO' };
    const oe = por((p) => p.codigoOE);
    if (oe) return { producto: oe, criterio: 'CODIGO_OE' };
    const r1 = por((p) => (p as any).refCruzada1);
    if (r1) return { producto: r1, criterio: 'REF_CRUZADA_1' };
    const r2 = por((p) => (p as any).refCruzada2);
    if (r2) return { producto: r2, criterio: 'REF_CRUZADA_2' };
    const porBarcode = this.barcodeToProductId.get(ref);
    if (porBarcode) {
      const prod = this.productos.find((p) => p.id === porBarcode) ?? null;
      if (prod) return { producto: prod, criterio: 'BARCODE' };
    }
    return { producto: null, criterio: null };
  }

  /**
   * I39: cruce por descripción para documentos SIN columna de referencia
   * (facturas de compra extranjera de proveedores como Magneti Marelli).
   * Normaliza (mayúsculas, sin tildes, espacios colapsados) y exige
   * coincidencia única y exacta — si dos productos comparten la descripción
   * no se adivina: queda como producto nuevo para corrección.
   */
  matchPorDescripcion(descripcion: string | null | undefined): MatchResult {
    const objetivo = normalizarDescripcion(descripcion);
    if (!objetivo) return { producto: null, criterio: null };
    const candidatos = this.productos.filter(
      (p) => normalizarDescripcion(p.descripcion) === objetivo,
    );
    if (candidatos.length === 1) {
      return { producto: candidatos[0], criterio: 'DESCRIPCION' };
    }
    return { producto: null, criterio: null };
  }

  /** I39: ¿ya existe un producto con este código en la empresa? */
  existeCodigo(codigo: string): boolean {
    const ref = codigo.trim().toUpperCase();
    return this.productos.some((p) => (p.codigo ?? '').trim().toUpperCase() === ref);
  }

  /**
   * I60: cruce tolerante para facturas emitidas por World Office, que trunca
   * el código del producto en el documento. La comparación exacta falla aunque
   * el producto sea el correcto y la factura se rechaza injustamente.
   *
   * Estrategia (siempre exigiendo coincidencia ÚNICA — nunca se adivina):
   *  1. Código parcial: la referencia de la factura se compara con la mayor
   *     cantidad de letras disponibles del código — prefijo en cualquiera de
   *     las dos direcciones (la factura trae el inicio del código, o el
   *     código cabe dentro de la referencia). Mínimo 4 caracteres útiles.
   *  2. Si hay varios candidatos, desempata comparando parte del nombre:
   *     gana el producto cuya descripción comparte más palabras con la de la
   *     factura, si el mejor es único y comparte al menos una palabra
   *     significativa.
   *  3. Si ningún código se parece, se intenta solo por el nombre: un único
   *     producto cuya descripción cubre la mayoría (≥60%) de las palabras de
   *     la factura.
   */
  matchParcial(referencia: string, descripcion?: string | null): MatchResult {
    const ref = normalizarCodigo(referencia);
    if (ref.length >= 4) {
      const campos: Array<(p: Product) => string | null | undefined> = [
        (p) => p.codigo,
        (p) => p.codigoOE,
        (p) => (p as any).refCruzada1,
        (p) => (p as any).refCruzada2,
      ];
      const candidatos = new Set<Product>();
      for (const campo of campos) {
        for (const p of this.productos) {
          const valor = normalizarCodigo(campo(p));
          if (valor.length >= 4 && (valor.startsWith(ref) || ref.startsWith(valor))) {
            candidatos.add(p);
          }
        }
      }
      if (candidatos.size === 1) {
        return { producto: [...candidatos][0], criterio: 'CODIGO_PARCIAL' };
      }
      if (candidatos.size > 1 && descripcion) {
        const mejor = mejorPorDescripcion([...candidatos], descripcion, 1);
        if (mejor) return { producto: mejor, criterio: 'CODIGO_PARCIAL_DESCRIPCION' };
      }
    }
    // Sin candidato por código: último recurso por parte del nombre.
    if (descripcion) {
      const mejor = mejorPorDescripcion(this.productos, descripcion, 0.6);
      if (mejor) return { producto: mejor, criterio: 'DESCRIPCION_PARCIAL' };
    }
    return { producto: null, criterio: null };
  }
}

/** I39: normalización de descripciones para el cruce exacto tolerante. */
function normalizarDescripcion(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** I60: normalización de códigos para el cruce parcial (WO trunca el campo). */
function normalizarCodigo(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '');
}

/**
 * I60: palabras significativas (≥3 letras) de una descripción normalizada.
 * Conjuntos tan pequeños que un Set alcanza y sobra.
 */
function palabrasDe(descripcion: string | null | undefined): Set<string> {
  return new Set(
    normalizarDescripcion(descripcion)
      .split(' ')
      .filter((w) => w.length >= 3),
  );
}

/**
 * I60: mejor candidato por coincidencia parcial del nombre.
 * Puntaje = palabras de la factura presentes en la descripción del producto.
 * Gana solo si es el mejor ÚNICO y su cobertura (palabras acertadas /
 * palabras de la factura) llega al mínimo pedido. Con empate no se adivina.
 */
function mejorPorDescripcion(
  candidatos: Product[],
  descripcionFactura: string,
  coberturaMinima: number,
): Product | null {
  const objetivo = palabrasDe(descripcionFactura);
  if (!objetivo.size) return null;
  let mejor: Product | null = null;
  let mejorPuntaje = 0;
  let empate = false;
  for (const p of candidatos) {
    const palabras = palabrasDe(p.descripcion);
    let puntaje = 0;
    for (const w of objetivo) if (palabras.has(w)) puntaje++;
    if (puntaje > mejorPuntaje) {
      mejor = p;
      mejorPuntaje = puntaje;
      empate = false;
    } else if (puntaje === mejorPuntaje && puntaje > 0) {
      empate = true;
    }
  }
  if (!mejor || empate) return null;
  // Con mínimo < 1 basta una palabra; con ≥ 1 (desempate de códigos) se
  // exige al menos una coincidencia y la cobertura es sobre el total.
  const cobertura = mejorPuntaje / objetivo.size;
  const minimo = coberturaMinima >= 1 ? 1 / objetivo.size : coberturaMinima;
  return cobertura >= minimo ? mejor : null;
}

export type EstadoComparacion = 'COINCIDE' | 'FALTANTE' | 'SOBRANTE' | 'NUEVO';

/** Paso 4 (M07) / HU-025: comparación factura vs. recibido por línea. */
export function compararItem(item: {
  cantidadFacturada: number;
  cantidadRecibida: number;
  esNuevo: boolean;
}): { diferencia: number; estado: EstadoComparacion } {
  const diferencia = item.cantidadRecibida - item.cantidadFacturada;
  if (item.esNuevo) return { diferencia, estado: 'NUEVO' };
  if (diferencia === 0) return { diferencia, estado: 'COINCIDE' };
  return { diferencia, estado: diferencia < 0 ? 'FALTANTE' : 'SOBRANTE' };
}
