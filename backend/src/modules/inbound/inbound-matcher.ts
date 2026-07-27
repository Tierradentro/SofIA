import { Product } from '../products/entities/product.entity';

export interface MatchResult {
  producto: Product | null;
  criterio: 'CODIGO' | 'CODIGO_OE' | 'REF_CRUZADA_1' | 'REF_CRUZADA_2' | 'BARCODE' | null;
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
