import {
  COLUMNAS_WO,
  WoPedidoInput,
  construirCsvWo,
  construirLineasWo,
  fechaWo,
  nitClienteWo,
  numeroWo,
  soloDigitos,
  validarExportacionWo,
  woConfigPorDefecto,
} from './world-office';

/**
 * I51/I52: pruebas del generador del CSV de World Office contra el fixture
 * que ya fue cargado exitosamente en WO (DocumentosVentas…3450.csv).
 * I52: config global + consecutivo por empresa; empresa/vendedor/nota salen
 * de la base de datos.
 */
describe('World Office (I51/I52) — generador CSV', () => {
  const config = woConfigPorDefecto();
  const empresaNombre = 'IMPORT - REPUESTOS EL ESCARABAJO S A S';

  // 09/10/2026 al mediodía en Bogotá (evita ambigüedad de zona horaria)
  const creado = new Date('2026-10-09T12:00:00-05:00');

  const pedido = (items: Partial<WoPedidoInput['items'][0]>[]): WoPedidoInput => ({
    id: 'p1',
    numero: 'IRE-0021',
    estado: 'ALISTADO',
    notas: 'COTIZACIÓN',
    createdAt: creado,
    exportadoWo: false,
    woDocumentoNumero: null,
    clienteIdentificacion: 'NIT 901689082 1',
    comercialIdentificacion: 'CC 4.245.245',
    items: items.map((it) => ({
      codigo: '311115175B',
      descripcion: 'COLADOR ACEITE ESC (250) PCJ BRASIL',
      cantidad: 20,
      valorUnidad: 25210,
      ...it,
    })),
  });
  const lineasDe = (p: WoPedidoInput, cfg = config, emp = empresaNombre) =>
    construirLineasWo({
      config: cfg,
      empresaNombre: emp,
      pedidos: [p],
      numerosWo: new Map([['p1', 3450]]),
    });

  it('la plantilla tiene exactamente 57 columnas (31 encabezado + 26 detalle)', () => {
    expect(COLUMNAS_WO.length).toBe(57);
    expect(COLUMNAS_WO.filter((c) => c.startsWith('Encabezados: ')).length).toBe(31);
    expect(COLUMNAS_WO.filter((c) => c.startsWith('Detalle: ')).length).toBe(26);
    // Regla crítica: prefijo completo "Encabezados:", no la abreviatura "Encab:"
    expect(COLUMNAS_WO.some((c) => c.startsWith('Encab:'))).toBe(false);
  });

  it('replica exactamente las líneas del fixture exitoso', () => {
    const p = pedido([
      { codigo: '311115175B', descripcion: 'COLADOR ACEITE ESC (250) PCJ BRASIL' },
      { codigo: '1131151792', descripcion: 'TAPA COLADOR ACEITE ESC BRASIL' },
    ]);
    expect(lineasDe(p)).toEqual([
      'IMPORT - REPUESTOS EL ESCARABAJO S A S,COT,,3450,09/10/2026,4245245,901689082,COTIZACIÓN,Credito 30 DIAS,09/10/2026,,3450,0,0,,,,,,,,,,,,,,,,,,311115175B,Principal,Und.,20,0.19,25210,0,08/11/2026,COLADOR ACEITE ESC (250) PCJ BRASIL,,,,,,,,,,,,,,,,,',
      'IMPORT - REPUESTOS EL ESCARABAJO S A S,COT,,3450,09/10/2026,4245245,901689082,COTIZACIÓN,Credito 30 DIAS,09/10/2026,,3450,0,0,,,,,,,,,,,,,,,,,,1131151792,Principal,Und.,20,0.19,25210,0,08/11/2026,TAPA COLADOR ACEITE ESC BRASIL,,,,,,,,,,,,,,,,,',
    ]);
  });

  it('el CSV lleva la fila de encabezados y no incluye BOM', () => {
    const csv = construirCsvWo({
      config,
      empresaNombre,
      pedidos: [pedido([{}])],
      numerosWo: new Map([['p1', 3450]]),
    });
    const filas = csv.split('\n');
    expect(filas[0]).toBe(COLUMNAS_WO.join(','));
    expect(filas.length).toBe(2);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('vendedor: solo números de la identificación del comercial', () => {
    expect(soloDigitos('CC 4.245.245')).toBe('4245245');
    expect(soloDigitos('1.045.234.567')).toBe('1045234567');
    expect(soloDigitos(null)).toBe('');
  });

  it('cliente: solo números; con texto NIT se elimina el último dígito (DV)', () => {
    expect(nitClienteWo('NIT 901689082 1')).toBe('901689082');
    expect(nitClienteWo('Nit 901.689.082-1')).toBe('901689082');
    expect(nitClienteWo('NIT9016890821')).toBe('901689082');
    // Sin texto NIT se conservan todos los dígitos
    expect(nitClienteWo('901.689.082-1')).toBe('9016890821');
    expect(nitClienteWo('800111222')).toBe('800111222');
    expect(nitClienteWo('CC 1.045.234.567')).toBe('1045234567');
    expect(nitClienteWo(null)).toBe('');
  });

  it('formatea fechas dd/mm/yyyy y suma días de vencimiento', () => {
    expect(fechaWo(creado)).toBe('09/10/2026');
    expect(fechaWo(creado, 30)).toBe('08/11/2026');
    expect(fechaWo(new Date('2026-12-20T12:00:00-05:00'), 30)).toBe('19/01/2027');
  });

  it('números sin separador de miles ni decimales de relleno', () => {
    expect(numeroWo('25210.00')).toBe('25210');
    expect(numeroWo(0.19)).toBe('0.19');
    expect(numeroWo('20')).toBe('20');
  });

  it('nota: observaciones del pedido; por defecto PEDIDO SOFIA #<numero>', () => {
    expect(lineasDe(pedido([{}]))[0].split(',')[7]).toBe('COTIZACIÓN');
    const sinNotas = { ...pedido([{}]), notas: null };
    expect(lineasDe(sinNotas)[0].split(',')[7]).toBe('PEDIDO SOFIA #IRE-0021');
  });

  it('la empresa emisora es el nombre de la empresa del pedido', () => {
    expect(lineasDe(pedido([{}]))[0].split(',')[0]).toBe(empresaNombre);
  });

  it('escapa campos con comillas o comas', () => {
    const p = pedido([{ descripcion: 'TAPA "ESPECIAL", BRASIL' }]);
    expect(lineasDe(p)[0]).toContain('"TAPA ""ESPECIAL"", BRASIL"');
  });
});

describe('World Office (I51/I52) — preflight', () => {
  const base: WoPedidoInput = {
    id: 'p1',
    numero: 'IRE-0021',
    estado: 'ALISTADO',
    notas: null,
    createdAt: new Date('2026-10-09T12:00:00-05:00'),
    exportadoWo: false,
    woDocumentoNumero: null,
    clienteIdentificacion: '901689082',
    comercialIdentificacion: '4245245',
    items: [{ codigo: 'X1', descripcion: 'Item', cantidad: 1, valorUnidad: 100 }],
  };
  const validar = (over: Partial<Parameters<typeof validarExportacionWo>[0]>) =>
    validarExportacionWo({
      config: woConfigPorDefecto(),
      empresaNombre: 'IMPORT - REPUESTOS EL ESCARABAJO S A S',
      consecutivoActual: 0,
      claveConsecutivo: 'wo.consecutivo.IRE',
      pedidos: [base],
      idsNoEncontrados: [],
      empresasMezcladas: false,
      ...over,
    });

  it('pedido válido → ok con rango de consecutivos', () => {
    const r = validar({});
    expect(r.ok).toBe(true);
    expect(r.resumen).toEqual({
      pedidos: 1,
      lineas: 1,
      documentoDesde: 1,
      documentoHasta: 1,
    });
  });

  it('bloquea pedidos no alistados', () => {
    const r = validar({ pedidos: [{ ...base, estado: 'APROBADO' }] });
    expect(r.ok).toBe(false);
    expect(r.errores[0].mensaje).toContain('ALISTADOS');
  });

  it('bloquea cliente sin identificación', () => {
    const r = validar({ pedidos: [{ ...base, clienteIdentificacion: null }] });
    expect(r.ok).toBe(false);
    expect(r.errores[0].mensaje).toContain('identificación');
  });

  it('bloquea si el pedido no tiene comercial con identificación', () => {
    const r = validar({ pedidos: [{ ...base, comercialIdentificacion: null }] });
    expect(r.ok).toBe(false);
    expect(r.errores[0].mensaje).toContain('comercial con identificación');
  });

  it('bloquea sin configuración global o sin consecutivo de la empresa', () => {
    expect(validar({ config: null }).ok).toBe(false);
    const r = validar({ consecutivoActual: null });
    expect(r.ok).toBe(false);
    expect(r.errores[0].mensaje).toContain('wo.consecutivo.IRE');
  });

  it('bloquea pedidos mezclados de varias empresas', () => {
    const r = validar({ empresasMezcladas: true });
    expect(r.ok).toBe(false);
    expect(r.errores[0].mensaje).toContain('misma empresa');
  });

  it('advierte reexportación (conserva su número) y valor cero sin bloquear', () => {
    const r = validar({
      pedidos: [
        {
          ...base,
          exportadoWo: true,
          woDocumentoNumero: 3450,
          items: [{ codigo: 'X1', descripcion: 'Item', cantidad: 1, valorUnidad: 0 }],
        },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.advertencias).toHaveLength(2);
    expect(r.advertencias[0].mensaje).toContain('valor unitario en cero');
    expect(r.advertencias[1].mensaje).toContain('conservará el documento 3450');
    // Los pedidos ya exportados no consumen consecutivo nuevo
    expect(r.resumen.documentoDesde).toBeNull();
    expect(r.resumen.documentoHasta).toBeNull();
  });
});
