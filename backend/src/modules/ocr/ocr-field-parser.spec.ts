import { readFileSync } from 'fs';
import { join } from 'path';
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
      valorUnitario: null,
      valorTotal: null,
    });
  });

  it('QA Func. 2.5: en documentos de venta extrae NIT, teléfono y valores por ítem', () => {
    const texto = [
      'ORDEN DE PEDIDO',
      'Cliente: Autorepuestos del Norte SA',
      'NIT: 900.123.456-7',
      'Teléfono: 310 555 1234',
      'REF-5001 | FILTRO DE ACEITE | 3 | UND | 25.000 | 75.000',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.ORDEN_PEDIDO);
    expect(r.nit).toBe('900.123.456-7');
    expect(r.telefono).toBe('310 555 1234');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].valorUnitario).toBe(25000);
    expect(r.items[0].valorTotal).toBe(75000);
  });

  it('QA Func. 2.5: en factura de importación NO busca NIT ni valores (esquema por tipo)', () => {
    const texto = [
      'INVOICE INV-9',
      'NIT: 900.123.456-7',
      'REF-5002 | PASTILLA | 2 | UND',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    expect(r.nit).toBeNull();
    expect(r.items).toHaveLength(1);
    // sin campos de valor en el esquema de importación
    expect(r.items[0].valorUnitario).toBeUndefined();
    expect(r.items[0].cantidad).toBe(2);
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

  it('I22: factura de venta colombiana real (FEIR10022, layout con columnas)', () => {
    // Texto tal como lo devuelve `pdftotext -layout` del PDF adjunto por el
    // usuario (Import Repuestos El Escarabajo — World Office)
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-feir10022.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    // Cabecera
    expect(r.numeroFactura).toBe('FEIR10022');
    expect(r.fecha).toBe('2026-08-14'); // "FECHA FACTURA 14-ago-26"
    expect(r.cliente).toBe('REPUESTOS AUDIVAG S.A.S');
    expect(r.direccion).toBe('CR 27A 67 15');
    expect(r.total).toBe(429352);
    // NIT del EMISOR (aparece primero en el documento) — se extrae, no null
    expect(r.nit).toBeTruthy();
    // Ítem: cantidad "4,00" y valores en formato colombiano
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toEqual({
      referencia: 'MCEVW1000MY',
      descripcion: 'ESPIRAL DEL GOL SAVEIRO VOYAGE DIR HIDRAULICA 2009 COFAP',
      cantidad: 4,
      unidad: 'UND',
      valorUnitario: 110000,
      valorTotal: 440000,
    });
  });

  it('I26: factura IRE con 16 ítems en columnas anchas (FE9832)', () => {
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-fe9832.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('FE9832');
    expect(r.fecha).toBe('2026-06-24');
    expect(r.cliente).toBe('EUROREPUESTOS DUITAMA');
    expect(r.direccion).toBe('CR 19 12A 15');
    expect(r.telefono).toBe('3115966545');
    expect(r.total).toBe(1882402);
    // El reporte del usuario: IRE traía el cliente pero NINGÚN producto
    expect(r.items).toHaveLength(16);
    expect(r.items[0]).toEqual({
      referencia: 'N1063',
      descripcion: 'AXIAL R/L GOLF4/JETTA/NEW BEETLE/AUDI A3 NAKATA',
      cantidad: 3,
      unidad: 'UND',
      valorUnitario: 24000,
      valorTotal: 72000,
    });
    // Referencias con "/" y números dentro de la descripción no rompen la cola
    const sachs = r.items.find((i) => i.referencia === '3000954268/6561');
    expect(sachs).toMatchObject({ cantidad: 1, valorUnitario: 345000, valorTotal: 345000 });
    const frena = r.items.find((i) => i.referencia === '861440');
    expect(frena).toMatchObject({ cantidad: 1, valorTotal: 80000 });
  });

  it('I26: factura IRE con referencia compuesta (FEIR10043: "10086/10094")', () => {
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-feir10043.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('FEIR10043');
    expect(r.cliente).toBe('VOLKSWAGEN SAGER SAS');
    expect(r.fecha).toBe('2026-08-21');
    expect(r.total).toBe(487900);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toEqual({
      referencia: '10086/10094',
      descripcion: 'BOMBA ACEITE CON TUBO GOL 1.6 1.8 GOLF3 VENTO SCHADEK',
      cantidad: 4,
      unidad: 'UND',
      valorUnitario: 125000,
      valorTotal: 500000,
    });
  });

  it('I26: factura ICV (FECV3440) — layout distinto ya no queda truncado', () => {
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-fecv3440.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('FECV3440');
    expect(r.fecha).toBe('2026-08-20'); // valores bajo los rótulos FECHA FACTURA
    expect(r.cliente).toBe('SOMOS CHEVROLET Y HYUNDAI SANDRA DEL CARMEN');
    expect(r.direccion).toBe('AV LUIS CARLOS GALAN 22 A 44'); // ciudad pegada se separa
    expect(r.telefono).toBe('2748741');
    expect(r.total).toBe(206346); // TOTAL MENOS RETENCIONES
    // Ítem con columna de unidad, IVA% y descripción en dos líneas
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toEqual({
      referencia: 'RK9310',
      descripcion: 'KIT REPARTICION CORSA 1.4 8 VALVULAS RANALLE',
      cantidad: 3,
      unidad: 'UND',
      valorUnitario: 68000,
      valorTotal: 204000,
    });
  });

  it('I22: cantidad con decimales ("4,00") y formato colombiano de miles', () => {
    const texto = [
      'FACTURA DE VENTA No ABC-123',
      'Item  Referencia  Descripción  Cant  Valor Unitario  Total',
      '1  REF-9001 FILTRO ACEITE  2,00  45.500  91.000',
      'TOTAL FACTURA  91.000',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('ABC-123');
    expect(r.items).toHaveLength(1);
    expect(r.items[0].cantidad).toBe(2);
    expect(r.items[0].valorUnitario).toBe(45500);
    expect(r.items[0].valorTotal).toBe(91000);
    expect(r.total).toBe(91000);
  });
});
