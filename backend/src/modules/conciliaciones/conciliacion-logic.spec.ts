import {
  conciliar,
  normalizarCodigo,
  normalizarTexto,
  parseNumeroWo,
  ProductoSofia,
} from './conciliacion-logic';

const productos: ProductoSofia[] = [
  {
    codigo: '560277/315910:009',
    descripcion: 'AMORTIGUADOR DEL VW GOLF MK7 350389 SACHS',
    marca: 'SACHS',
    unidadMedida: 'UND',
    codigoOE: '315910',
    cantidad: 10,
    precio: 325000,
  },
  {
    codigo: 'BMM0630AY',
    descripcion: 'BOMBA AGUA FOX CROSSFOX GOLF4 1.6 FABIA MAGNETI',
    marca: 'MAGNETI MARELLI',
    unidadMedida: 'UND',
    codigoOE: null,
    cantidad: 5,
    precio: 65000,
  },
  {
    codigo: 'N1075',
    descripcion: 'ROTULA DER GOL 5 SAVEIRO VOYAGE CROSSFOX NAKATA',
    marca: 'NAKATA',
    unidadMedida: 'UND',
    codigoOE: null,
    cantidad: 0,
    precio: 30000,
  },
];

describe('conciliacion-logic (I65h)', () => {
  it('parseNumeroWo entiende formato colombiano e internacional', () => {
    expect(parseNumeroWo('650.000')).toBe(650000);
    expect(parseNumeroWo('1.234.567,89')).toBe(1234567.89);
    expect(parseNumeroWo('2,00')).toBe(2);
    expect(parseNumeroWo('1234.56')).toBe(1234.56);
    expect(parseNumeroWo('$ 325.000')).toBe(325000);
    expect(parseNumeroWo('abc')).toBeNull();
    expect(parseNumeroWo('')).toBeNull();
  });

  it('normaliza texto y códigos', () => {
    expect(normalizarTexto('  Ámortíguador  DEL ')).toBe('AMORTIGUADOR DEL');
    expect(normalizarCodigo('560277/315910:009')).toBe('560277315910009');
  });

  it('coincidencia exacta sin diferencias', () => {
    const r = conciliar(
      [{ codigo: 'BMM0630AY', existencia: '5', precio: '65.000' }],
      productos,
      ['existencia', 'precio'],
    );
    expect(r.filas).toHaveLength(3); // la fila + 2 faltantes en WO
    const fila = r.filas.find((f) => f.codigo === 'BMM0630AY')!;
    expect(fila.estado).toBe('COINCIDE');
    expect(r.coinciden).toBe(1);
    // N1075 tiene precio>0 y 560277 tiene cantidad>0: ambos faltan en WO
    expect(r.faltantesEnWo).toBe(2);
  });

  it('detecta diferencias de existencia y precio', () => {
    const r = conciliar(
      [{ codigo: 'BMM0630AY', existencia: '3', precio: '70.000' }],
      productos,
      ['existencia', 'precio'],
    );
    const fila = r.filas.find((f) => f.codigo === 'BMM0630AY')!;
    expect(fila.estado).toBe('DIFERENCIA');
    expect(fila.diferencias).toEqual([
      { campo: 'existencia', valorWo: '3', valorSofia: '5' },
      { campo: 'precio', valorWo: '70.000', valorSofia: '65000' },
    ]);
    expect(r.conDiferencias).toBe(1);
  });

  it('cruza códigos con separadores distintos (normalizado)', () => {
    const r = conciliar(
      [{ codigo: '560277315910009', existencia: '10', precio: '325.000' }],
      productos,
      ['existencia', 'precio'],
    );
    const fila = r.filas.find((f) => f.codigo === '560277/315910:009')!;
    expect(fila.estado).toBe('COINCIDE');
  });

  it('reporta códigos de WO no encontrados en SofIA', () => {
    const r = conciliar(
      [{ codigo: 'INEXISTENTE', existencia: '1' }],
      productos,
      ['existencia'],
    );
    const fila = r.filas.find((f) => f.codigo === 'INEXISTENTE')!;
    expect(fila.estado).toBe('NO_ENCONTRADO_EN_SOFIA');
    expect(r.noEncontrados).toBe(1);
  });

  it('compara campos de texto mapeados (descripción, marca)', () => {
    const r = conciliar(
      [
        {
          codigo: 'N1075',
          descripcion: 'ROTULA DER GOL 5 NAKATA',
          marca: 'nakata',
        },
      ],
      productos,
      ['descripcion', 'marca'],
    );
    const fila = r.filas.find((f) => f.codigo === 'N1075')!;
    expect(fila.estado).toBe('DIFERENCIA');
    expect(fila.diferencias).toEqual([
      {
        campo: 'descripcion',
        valorWo: 'ROTULA DER GOL 5 NAKATA',
        valorSofia: 'ROTULA DER GOL 5 SAVEIRO VOYAGE CROSSFOX NAKATA',
      },
    ]); // marca solo difiere en mayúsculas: coincide
  });

  it('los productos sin existencia ni precio no se reportan como faltantes', () => {
    const r = conciliar([], [
      { ...productos[2], precio: 0 },
    ], ['existencia']);
    expect(r.faltantesEnWo).toBe(0);
  });
});
