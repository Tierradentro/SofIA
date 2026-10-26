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

  it('I39: cruza por descripción normalizada cuando el documento no trae referencia', () => {
    const prods = [
      prod({ id: 'p9', codigo: 'AMO-G3', descripcion: 'Amortiguador tras Golf3 con plato Cofap' }),
      prod({ id: 'p10', codigo: 'DUP-1', descripcion: 'BUJE BARRA DIR GOL PLUS COFAP' }),
      prod({ id: 'p11', codigo: 'DUP-2', descripcion: 'BUJE BARRA DIR GOL PLUS COFAP' }),
    ] as Product[];
    const m = new InboundMatcher(prods, new Map());
    // Coincidencia única tolerante a mayúsculas/tildes/puntuación
    const r = m.matchPorDescripcion('AMORTIGUADOR TRAS GOLF3 CON PLATO COFAP');
    expect(r.producto?.id).toBe('p9');
    expect(r.criterio).toBe('DESCRIPCION');
    // Descripción duplicada: no se adivina
    expect(m.matchPorDescripcion('BUJE BARRA DIR GOL PLUS COFAP').producto).toBeNull();
    // Desconocida o vacía: null
    expect(m.matchPorDescripcion('NO EXISTE ESTE REPUESTO').producto).toBeNull();
    expect(m.matchPorDescripcion('').producto).toBeNull();
    expect(m.matchPorDescripcion(null).producto).toBeNull();
  });

  it('I39: existeCodigo compara sin distinguir mayúsculas', () => {
    const m = new InboundMatcher(
      [prod({ id: 'p1', codigo: 'SR-61-01' })] as Product[],
      new Map(),
    );
    expect(m.existeCodigo('sr-61-01')).toBe(true);
    expect(m.existeCodigo('SR-61-02')).toBe(false);
  });

  describe('I60: cruce tolerante a códigos truncados por World Office', () => {
    const prodsWo = [
      prod({ id: 'w1', codigo: 'ABC12345X', descripcion: 'FILTRO ACEITE MOTOR 1.6' }),
      prod({ id: 'w2', codigo: 'XYZ99999', descripcion: 'PASTILLA FRENO DELANTERA' }),
      prod({ id: 'w3', codigo: 'ABC12DEF', descripcion: 'BUJIA ENCENDIDO IRIDIO' }),
    ] as Product[];
    const mWo = new InboundMatcher(prodsWo, new Map());

    it('código truncado por la factura (prefijo) matchea único', () => {
      const r = mWo.matchParcial('XYZ999');
      expect(r.producto?.id).toBe('w2');
      expect(r.criterio).toBe('CODIGO_PARCIAL');
    });

    it('código completo contenido en la referencia también matchea', () => {
      const r = mWo.matchParcial('ABC12345X-LOTE');
      expect(r.producto?.id).toBe('w1');
      expect(r.criterio).toBe('CODIGO_PARCIAL');
    });

    it('prefijo ambiguo desempata por parte del nombre', () => {
      // ABC12 es prefijo de w1 (ABC12345X) y de w3 (ABC12DEF)
      const r = mWo.matchParcial('ABC12', 'BUJIA ENCENDIDO IRIDIO NGK');
      expect(r.producto?.id).toBe('w3');
      expect(r.criterio).toBe('CODIGO_PARCIAL_DESCRIPCION');
    });

    it('prefijo ambiguo sin nombre no adivina', () => {
      expect(mWo.matchParcial('ABC12').producto).toBeNull();
      expect(mWo.matchParcial('ABC12', 'DESCRIPCION QUE NO CUADRA').producto).toBeNull();
    });

    it('sin código parecido cruza por parte del nombre (único y mayoritario)', () => {
      const r = mWo.matchParcial('SINCODIGO', 'FILTRO ACEITE MOTOR 1.6 BOSCH');
      expect(r.producto?.id).toBe('w1');
      expect(r.criterio).toBe('DESCRIPCION_PARCIAL');
    });

    it('referencia muy corta no cruza por código', () => {
      expect(mWo.matchParcial('AB').producto).toBeNull();
    });

    it('referencia sin relación con nada sigue sin cruzar', () => {
      expect(mWo.matchParcial('QWERTY0000', 'NADA QUE VER AQUI').producto).toBeNull();
    });
  });
});
