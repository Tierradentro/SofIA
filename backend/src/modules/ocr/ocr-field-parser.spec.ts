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


  it('I64b: referencia con dos puntos de WO ("560277/315910:0") no se pierde (FEIR10325)', () => {
    // Texto tal como lo devuelve `pdftotext -layout` de la factura real FEIR
    // 10325. El primer ítem tiene referencia con ':' (código truncado de
    // 560277/315910:009) y antes del ajuste se descartaba la línea completa.
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-feir10325.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('FEIR10325');
    expect(r.items).toHaveLength(15);
    expect(r.items[0]).toEqual({
      referencia: '560277/315910:0',
      descripcion: 'AMORTIGUADOR DEL VW GOLF MK7 350389 SACHS',
      cantidad: 2,
      unidad: 'UND',
      valorUnitario: 325000,
      valorTotal: 650000,
    });
  });

  it('I69: factura de 14 ítems con pares DER/IZQ no pierde los izquierdos (FEIR10349)', () => {
    // Texto tal como lo devuelve `pdftotext -layout` de la factura real FEIR
    // 10349. Caso reportado: el pedido quedó con 12 productos porque los dos
    // amortiguadores IZQ (JGM5125SL y 34171G) no aparecían; el parser debe
    // extraer los 14 ítems completos.
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-feir10349.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('FEIR10349');
    expect(r.items).toHaveLength(14);
    const refs = r.items.map((i) => i.referencia);
    expect(refs).toContain('JGM5125SR');
    expect(refs).toContain('JGM5125SL'); // izquierdo AVEO — el que faltaba
    expect(refs).toContain('34170G');
    expect(refs).toContain('34171G'); // izquierdo CRONOS — el que faltaba
    expect(r.items.find((i) => i.referencia === 'JGM5125SL')).toMatchObject({
      cantidad: 1,
      descripcion: 'AMORTIGUADOR DEL IZQ AVEO 1.4 1.6 TRW',
    });
    expect(r.items.find((i) => i.referencia === '34171G')).toMatchObject({
      cantidad: 1,
      descripcion: 'AMORTIGUADOR DEL IZQ CRONOS SPARK II 06> CORVEN',
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

  it('I39: factura de compra extranjera FCE 61 (Magneti Marelli) sin columna de referencia', () => {
    // Texto tal como lo devuelve `pdftotext -layout` del PDF adjunto por el
    // usuario: ítems "solo descripción" con la cantidad junto a "Und.",
    // IVA% intermedio y descripciones que continúan tras la cola numérica.
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-importacion-fce61.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    // Cabecera: folio del título, fecha larga en español, proveedor truncado
    expect(r.numeroFactura).toBe('61');
    expect(r.fecha).toBe('2026-07-24'); // "viernes, 24 de julio de 2026"
    expect(r.proveedor).toBe('MAGNETI MARELLI');
    expect(r.direccion).toBe('AV MANOEL DA NOBREGA 1');
    expect(r.total).toBe(74880663); // TOTAL DOCUMENTO
    // Los 38 ítems de la factura, todos sin referencia y con valores
    expect(r.items).toHaveLength(38);
    expect(r.items[0]).toEqual({
      referencia: '',
      descripcion: 'AMORTIGUADOR TRAS GOLF3 CON PLATO COFAP',
      cantidad: 92,
      unidad: 'UND',
      valorUnitario: 12877,
      valorTotal: 1184706,
    });
    // Descripciones que envuelven a la línea siguiente se reconstruyen
    const kitX2p = r.items.find((i) => i.cantidad === 300);
    expect(kitX2p?.descripcion).toBe(
      'KIT TOPE Y GUARDAPOLVO AMORT DEL GOL X2P BRASIL COFAP',
    );
    const tracker = r.items.find((i) => i.cantidad === 24);
    expect(tracker?.descripcion).toBe(
      'KIT TOPE Y GUARDAPOLVO AMORT DEL CHEVROLET TRACKER 2014 COFAP',
    );
    // Cantidades con modelos/años dentro de la descripción no se confunden
    const espiral = r.items.find((i) => i.cantidad === 4);
    expect(espiral?.descripcion).toBe('ESPIRAL DEL GOL 1.6 1.8 00>09 COFAP');
    // La suma de los totales cuadra con el SUBTOTAL del documento (±1 peso
    // de redondeo propio de la factura original)
    const suma = r.items.reduce((a, i) => a + (i.valorTotal ?? 0), 0);
    expect(Math.abs(suma - 79342772)).toBeLessThanOrEqual(1);
  });

  it('I39: tolera la cantidad pegada a la unidad ("92Und.") como sale de Tesseract', () => {
    const texto = [
      'AMORTIGUADOR TRAS GOLF3 CON PLATO COFAP 92Und. 12.877 0% 1.184.706',
      'BOBINA IGNICION GOL 1.6 MAGNETI 20Und. 22.535 0% 450.703',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({
      referencia: '',
      descripcion: 'AMORTIGUADOR TRAS GOLF3 CON PLATO COFAP',
      cantidad: 92,
      unidad: 'UND',
      valorUnitario: 12877,
      valorTotal: 1184706,
    });
    expect(r.items[1].cantidad).toBe(20);
  });

  it('I68: factura FECV 3584 (ICV) — 59 ítems completos, sin referencias perdidas ni pegadas', () => {
    // Texto tal como lo devuelve `pdftotext -layout` de la factura real FECV
    // 3584. Dos problemas hacían fallar la aprobación del pedido:
    //  1) número de ítem pegado a la referencia con UN solo espacio
    //     ("39 39869  SENSOR…") → el ítem salía sin referencia y la
    //     comparación reportaba FALTANTE_EN_FACTURA / EXTRA_EN_FACTURA;
    //  2) descripción pegada a la referencia sin espacio
    //     ("1J0129684CGMANGUERA") → la ref no cruzaba con el catálogo.
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-fecv3584.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('FECV3584');
    expect(r.cliente).toBe('SURTIVOLKSWAGEN RISARALDA SAS');
    expect(r.fecha).toBe('2026-11-05');
    // Los 59 ítems de la factura, todos con referencia (antes 24 salían con '')
    expect(r.items).toHaveLength(59);
    expect(r.items.every((i) => i.referencia !== '')).toBe(true);
    // Los ítems del caso reportado por el usuario
    const sensor = r.items.find((i) => i.referencia === '39869');
    expect(sensor).toMatchObject({ cantidad: 1, valorUnitario: 87000 });
    const pera = r.items.find((i) => i.referencia === '056919081C');
    expect(pera).toMatchObject({
      cantidad: 2,
      descripcion: 'PERA PRESION ACEITE GOLF A3 0.15 -',
      valorTotal: 30000,
    });
    // Referencias con descripción pegada: se separan correctamente
    expect(r.items.find((i) => i.referencia === '1J0129684CG')).toMatchObject({
      descripcion: 'MANGUERA DE ADMINISION DE AIRE JETTA 4 COOLXPERT',
      cantidad: 2,
    });
    expect(r.items.find((i) => i.referencia === '191598625AR')).toMatchObject({
      cantidad: 4,
      valorTotal: 104000,
    });
    expect(r.items.find((i) => i.referencia === 'TC-355-11-2M')).toMatchObject({
      descripcion: 'EMPAQUE CULATA METALICO AMAROK 2 ILLINOIS',
      cantidad: 2,
    });
    expect(r.items.find((i) => i.referencia === '1J6955651/1T')).toMatchObject({
      cantidad: 5,
      valorUnitario: 25000,
    });
    // Cantidad alta con slash en la ref y continuación de descripción
    expect(r.items.find((i) => i.referencia === '5U0927753/6')).toMatchObject({
      cantidad: 30,
      valorTotal: 600000,
    });
    // La suma de los totales cuadra con el SUBTOTAL del documento
    const suma = r.items.reduce((a, i) => a + (i.valorTotal ?? 0), 0);
    expect(suma).toBe(5934500);
  });

  it('I71: factura de compra FC 1241 — empresa, NIT, ítems con decimales truncados y valores descartados', () => {
    // Texto tal como lo devuelve `pdftotext -layout` del PDF adjunto por el
    // usuario: encabezado con la empresa emisora a la izquierda del rótulo
    // "FACTURA DE COMPRA", NIT propio en la línea siguiente, e ítems
    // "REF  DESCRIPCIÓN  5,00  Und.  51.113  19%  255.565" (la cantidad va
    // antes de la unidad y los valores monetarios se descartan).
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-compra-fc1241.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    // Cabecera: folio, empresa emisora y su NIT (no el del proveedor)
    expect(r.numeroFactura).toBe('1241');
    expect(r.empresaFactura).toBe('IMPORT - REPUESTOS EL ESCARABAJO S A S');
    expect(r.nitEmpresa).toBe('900349362');
    expect(r.proveedor).toBe('FRAS-LE PANAMERICANA S.A.S');
    expect(r.fecha).toBe('2026-11-11'); // "miércoles, 11 de noviembre de 2026"
    // Las 24 líneas de producto de la factura (refs repetidas incluidas)
    expect(r.items).toHaveLength(24);
    // Cantidades con decimales: solo cuenta el entero ("5,00" → 5)
    expect(r.items[0]).toEqual({
      referencia: 'NBJ1011DP',
      descripcion: 'TIJERA DER NVO GOL C/BUJES C/ROTULA NAKATA',
      cantidad: 5,
      unidad: 'UND',
    });
    // Referencia repetida: las dos líneas de NBJ1011EP se conservan
    const tijerasIzq = r.items.filter((i) => i.referencia === 'NBJ1011EP');
    expect(tijerasIzq.map((i) => i.cantidad)).toEqual([26, 10]);
    expect(r.items.find((i) => i.referencia === 'N111')).toMatchObject({
      descripcion: 'ROTULA SUP ESC NAKATA',
      cantidad: 300,
    });
    expect(r.items.find((i) => i.referencia === 'NKJ1153')).toMatchObject({
      descripcion: 'CAUCHO CANDELERO ESCARABAJO NAKATA',
      cantidad: 170,
    });
    // Referencia con guion y continuación de descripción con medidas
    expect(r.items.find((i) => i.referencia === 'NJH01-839')).toMatchObject({
      cantidad: 10,
    });
    // Último ítem de la página 2
    expect(r.items[23]).toMatchObject({
      referencia: 'NBJ1009',
      descripcion: 'TIJERA JETTA4 00>14 NAKATA',
      cantidad: 30,
    });
    // Los valores monetarios no viajan al ingreso de mercancía
    expect(r.items.every((i) => i.valorUnitario == null && i.valorTotal == null)).toBe(true);
  });

  it('I72: código LARGO truncado con descripción pegada (FECV 3610 — 377959455/002-60-01988)', () => {
    // Texto tal como lo devuelve `pdftotext -layout` del PDF adjunto por el
    // usuario. El ítem 5 es un código de 19 caracteres que World Office
    // trunca a 12 y la descripción queda PEGADA al recorte:
    // "377959455/00MOTOVENTILADOR" (26 chars, supera el largo de referencia).
    // Antes caía como ítem "sin referencia" y la aprobación del pedido
    // fallaba con FALTANTE_EN_FACTURA / EXTRA_EN_FACTURA.
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/factura-venta-fecv3610.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_VENTA);
    expect(r.numeroFactura).toBe('FECV3610');
    expect(r.fecha).toBe('2026-11-18');
    // Los 8 ítems de la factura
    expect(r.items).toHaveLength(8);
    // El código truncado se separa de la descripción pegada y conserva el
    // prefijo: el cruce por prefijo (I60/I64) lo completa contra el pedido
    const moto = r.items.find((i) => i.referencia === '377959455/00');
    expect(moto).toMatchObject({
      descripcion: 'MOTOVENTILADOR VW GOL 98 COOLXPERT',
      cantidad: 2,
      unidad: 'UND',
      valorUnitario: 155462,
      valorTotal: 310924,
    });
    // Ningún ítem queda sin referencia
    expect(r.items.every((i) => i.referencia.length > 0)).toBe(true);
    // Los demás ítems se reconocen con sus cantidades
    expect(r.items.find((i) => i.referencia === '7856')).toMatchObject({
      descripcion: 'BUJE TIJERA PEQUEÑO GOLF3 JETTA4 FEBI',
      cantidad: 20,
    });
    expect(r.items.find((i) => i.referencia === '36752')).toMatchObject({ cantidad: 8 });
    expect(r.items.find((i) => i.referencia === '23548')).toMatchObject({ cantidad: 5 });
    expect(r.items.find((i) => i.referencia === '33711')).toMatchObject({ cantidad: 5 });
    expect(r.items.find((i) => i.referencia === '044907385A')).toMatchObject({
      descripcion: 'POTENCIOMETRO GOLF 1.8 HELLA',
      cantidad: 2,
    });
    expect(r.items.find((i) => i.referencia === '15908')).toMatchObject({ cantidad: 1 });
    expect(r.items.find((i) => i.referencia === '6688')).toMatchObject({
      descripcion: 'TENSOR CORREA REPARTICION GOLF3 FEBI',
      cantidad: 6,
    });
    // La suma de los totales cuadra con el SUBTOTAL del documento
    const suma = r.items.reduce((a, i) => a + (i.valorTotal ?? 0), 0);
    expect(suma).toBe(1620161);
  });

  it('I74: registro de IMPORTACIÓN 233 (Schadek) — columna Código sin unidad y dirección con número', () => {
    // Texto tal como lo devuelve `pdftotext -layout` del PDF adjunto por el
    // usuario. Mismo ERP de la FCE 61, pero el registro de IMPORTACIÓN sí
    // tiene columna Código y NO tiene unidad:
    // "62001  JGO BALANCINES CORSA 1400 X8 SCHADEK  150  41.687  0%  6.253.111"
    // Antes: los 20 ítems se perdían (cola monetaria sin unidad) y la fila
    // de la dirección del proveedor ("RUA JOAO THOMAZ … EXT 2") salía como
    // ítem con referencia "RUA" y cantidad 2.
    const texto = readFileSync(
      join(__dirname, '../../../test/fixtures/importacion-imp233.txt'),
      'utf8',
    );
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    // Cabecera: folio del título, empresa emisora y su NIT, proveedor, fecha
    expect(r.numeroFactura).toBe('233');
    expect(r.empresaFactura).toBe('IMPORT - REPUESTOS EL ESCARABAJO');
    expect(r.nitEmpresa).toBe('900349362');
    expect(r.proveedor).toBe('METALURGICA SCHADEK LTDA');
    expect(r.fecha).toBe('2026-10-20'); // "martes, 20 de octubre de 2026"
    expect(r.total).toBe(66821737);
    // Los 20 ítems del registro, todos CON referencia y sin valores
    expect(r.items).toHaveLength(20);
    expect(r.items.every((i) => i.referencia.length > 0)).toBe(true);
    expect(r.items.every((i) => i.valorUnitario == null && i.valorTotal == null)).toBe(true);
    expect(r.items[0]).toEqual({
      referencia: '62001',
      descripcion: 'JGO BALANCINES CORSA 1400 X8 SCHADEK',
      cantidad: 150,
      unidad: 'UND',
    });
    // La dirección del proveedor NO es un ítem (era el falso "RUA" × 2)
    expect(
      r.items.some(
        (i) =>
          /^(RUA|AV|AVENIDA|CALLE|CARRERA|DIAGONAL|TRANSVERSAL)$/i.test(i.referencia) ||
          (i.descripcion ?? '').includes('JOAO THOMAZ'),
      ),
    ).toBe(false);
    // Descripciones que envuelven a la línea siguiente se reconstruyen,
    // incluso cuando la continuación arranca con número ("16 VAL SCHADEK")
    expect(r.items.find((i) => i.referencia === '10235')?.descripcion).toBe(
      'BOMBA ACEITE 22 DIENTES CLIO SCENIC MEGANE 1.6 16 VAL SCHADEK',
    );
    expect(r.items.find((i) => i.referencia === '60017')?.descripcion).toBe(
      'EJE LEVAS CHEVROLET CORSA 1.4 1.6 1.8 8 VALVULAS SCHADEK',
    );
    // Código compuesto más ancho que la columna (queda pegado a la
    // descripción con un solo espacio): "10086/10094 BOMBA ACEITE …"
    expect(r.items.find((i) => i.referencia === '10086/10094')).toMatchObject({
      descripcion: 'BOMBA ACEITE CON TUBO GOL 1.6 1.8 GOLF3 VENTO SCHADEK',
      cantidad: 20,
    });
    // Las cantidades cuadran con el documento
    const cantidades = r.items.map((i) => i.cantidad);
    expect(cantidades).toEqual([
      150, 150, 20, 40, 30, 20, 30, 10, 80, 80, 40, 200, 30, 30, 150, 30, 40,
      20, 50, 25,
    ]);
  });

  it('I74: el formato IMPORTACIÓN también se reconoce con columnas colapsadas (Tesseract)', () => {
    const texto = [
      '62001 JGO BALANCINES CORSA 1400 X8 SCHADEK 150 41.687 0% 6.253.111',
      '10086/10094 BOMBA ACEITE CON TUBO GOL 1.6 1.8 GOLF3 VENTO 20 36.271 0% 725.417',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toEqual({
      referencia: '62001',
      descripcion: 'JGO BALANCINES CORSA 1400 X8 SCHADEK',
      cantidad: 150,
      unidad: 'UND',
    });
    expect(r.items[1]).toMatchObject({
      referencia: '10086/10094',
      cantidad: 20,
    });
  });

  it('I74: una línea de dirección nunca es un ítem, con o sin fila de rótulos', () => {
    // La dirección del proveedor termina en número y antes salía como
    // producto con referencia "RUA" y cantidad 2
    const texto = [
      'DIRECCION                           TELEFONO                   PAIS ORIGEN                      PAIS COMPRA',
      'RUA JOAO THOMAZ DE ALMEIDA.900-VILA 55153262-8890 EXT 2',
      '62001 JGO BALANCINES CORSA 1400 X8 SCHADEK 150 41.687 0% 6.253.111',
      'CALLE 45 # 12-30 INT 7',
    ].join('\n');
    const r = parser.parse(texto, DocumentType.FACTURA_IMPORTACION);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].referencia).toBe('62001');
    // La dirección quedó como dato de cabecera, no como producto
    expect(r.direccion).toContain('RUA JOAO THOMAZ');
  });
});
