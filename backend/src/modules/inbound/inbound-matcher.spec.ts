import { InboundMatcher, compararItem } from './inbound-matcher';
import { Product } from '../products/entities/product.entity';

function prod(parcial: Partial<Product>): Product {
  return parcial as Product;
}

/**
 * Matching de referencias del documento de ingreso (M07/M08): código propio
 * primero, luego OE, cruzadas 1/2 y barcode. Comparación factura vs. recibido
 * (paso 4, HU-025).
 */
describe('InboundMatcher', () => {
  const productos = [
    prod({ id: 'p1', codigo: 'FIL-001', codigoOE: 'OE-999', refCruzada1: 'RC1-50', refCruzada2: null }),
    prod({ id: 'p2', codigo: 'FIL-002', codigoOE: null, refCruzada1: null, refCruzada2: 'RC2-80' }),
  ] as Product[];
  const barcodes = new Map([['750000111', 'p2']]);
  const matcher = new InboundMatcher(productos, barcodes);

  it('matchea por código propio con prioridad', () => {
    const r = matcher.match('fil-001');
    expect(r.producto?.id).toBe('p1');
    expect(r.criterio).toBe('CODIGO');
  });

  it('matchea por código OE cuando el código propio no existe', () => {
    const r = matcher.match('OE-999');
    expect(r.producto?.id).toBe('p1');
    expect(r.criterio).toBe('CODIGO_OE');
  });

  it('matchea por referencias cruzadas 1 y 2', () => {
    expect(matcher.match('RC1-50').criterio).toBe('REF_CRUZADA_1');
    expect(matcher.match('RC2-80').criterio).toBe('REF_CRUZADA_2');
  });

  it('matchea por código de barras como último criterio', () => {
    const r = matcher.match('750000111');
    expect(r.producto?.id).toBe('p2');
    expect(r.criterio).toBe('BARCODE');
  });

  it('referencia desconocida no matchea (producto nuevo)', () => {
    const r = matcher.match('NO-EXISTE');
    expect(r.producto).toBeNull();
    expect(r.criterio).toBeNull();
  });

  it('compararItem: coincide, faltante, sobrante y nuevo (HU-025)', () => {
    expect(compararItem({ cantidadFacturada: 10, cantidadRecibida: 10, esNuevo: false }))
      .toEqual({ diferencia: 0, estado: 'COINCIDE' });
    expect(compararItem({ cantidadFacturada: 10, cantidadRecibida: 7, esNuevo: false }))
      .toEqual({ diferencia: -3, estado: 'FALTANTE' });
    expect(compararItem({ cantidadFacturada: 10, cantidadRecibida: 12, esNuevo: false }))
      .toEqual({ diferencia: 2, estado: 'SOBRANTE' });
    expect(compararItem({ cantidadFacturada: 5, cantidadRecibida: 5, esNuevo: true }).estado)
      .toBe('NUEVO');
  });
});
