import { OcrFieldParser } from './ocr-field-parser';
import { DocumentType } from '../../common/enums/document-type.enum';

/**
 * Parser heurístico del OCR local: patrones de facturas/órdenes en español
 * e inglés, tolerante a ruido (lo no reconocido queda null para corrección).
 */
describe('OcrFieldParser', () => {
  const parser = new OcrFieldParser();

  it('extrae cabecera e items de una factura en inglés', () => {
    const texto = [
      'ACME PARTS LLC',
      'INVOICE INV-2026-0042',
      'DATE 2026-07-15',
      'SUPPLIER: ACME PARTS LLC',
      'REF-1001 OIL FILTER 10 UND',
      'REF-1002 BRAKE PADS 5 PCS',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    expect(r.numeroFactura).toBe('INV-2026-0042');
    expect(r.fecha).toBe('2026-07-15');
    expect(r.proveedor).toBe('ACME PARTS LLC');
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({
      referencia: 'REF-1001',
      descripcion: 'OIL FILTER',
      cantidad: 10,
      unidad: 'UND',
    });
    expect(r.items[1].cantidad).toBe(5);
    expect(r.items[1].unidad).toBe('PCS');
  });

  it('extrae campos de una orden de pedido en español', () => {
    const texto = [
      'ORDEN DE PEDIDO',
      'Cliente: Autorepuestos del Norte SA',
      'Dirección: Calle 45 # 12-30, Bogotá',
      'Fecha: 15/07/2026',
      '7501234 FILTRO DE AIRE 20 UND',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.ORDEN_PEDIDO);
    expect(r.cliente).toBe('Autorepuestos del Norte SA');
    expect(r.direccion).toBe('Calle 45 # 12-30, Bogotá');
    expect(r.fecha).toBe('2026-07-15');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].referencia).toBe('7501234');
    expect(r.items[0].cantidad).toBe(20);
  });

  it('soporta líneas con separadores de tabla (|)', () => {
    const texto = ['REF-2001 | PASTILLAS DE FRENO | 12 | UND'].join('\n');
    const r = parser.parse(texto, DocumentType.ORDEN_PEDIDO);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toEqual({
      referencia: 'REF-2001',
      descripcion: 'PASTILLAS DE FRENO',
      cantidad: 12,
      unidad: 'UND',
    });
  });

  it('extrae número de guía y transportadora', () => {
    const texto = [
      'GUIA N° 807654321',
      'Transportadora: Coordinadora Mercantil',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.GUIA_TRANSPORTE);
    expect(r.numeroGuia).toBe('807654321');
    expect(r.transportadora).toBe('Coordinadora Mercantil');
  });

  it('no inventa campos: lo no reconocido queda null', () => {
    const r = parser.parse('texto sin estructura conocida', DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBeNull();
    expect(r.fecha).toBeNull();
    expect(r.items).toHaveLength(0);
  });

  it('la línea de totales no se confunde con un item', () => {
    const texto = ['REF-3001 KIT CADENA 3 JGO', 'TOTAL 5'].join('\n');
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].referencia).toBe('REF-3001');
  });
});
