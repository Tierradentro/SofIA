import {
  claveDireccion,
  direccionDuplicada,
  normalizarDireccion,
  similitudDireccion,
  UMBRAL_SIMILITUD_DIRECCION,
} from './normalizar-direccion';

describe('normalizarDireccion (I20)', () => {
  it('ignora mayúsculas y espacios redundantes', () => {
    expect(normalizarDireccion('Calle 10 # 5-20')).toBe(
      normalizarDireccion('calle  10   #5-20'),
    );
  });

  it('quita la puntuación frecuente (# . , - /)', () => {
    expect(normalizarDireccion('CALLE 10 # 5 - 20.')).toBe('calle 10 5 20');
  });

  it('quita tildes', () => {
    expect(normalizarDireccion('Cra. 7ma # 71-20, Bogotá')).toContain('bogota');
    expect(normalizarDireccion('Diagonal 45B # 7-20')).toBe(
      normalizarDireccion('diagonal 45b # 7-20'),
    );
  });

  it('expande abreviaturas colombianas (cra/cr, cl, av, dg, tr)', () => {
    expect(normalizarDireccion('Cra. 10 # 5-20')).toBe('carrera 10 5 20');
    expect(normalizarDireccion('Cr 10 # 5-20')).toBe('carrera 10 5 20');
    expect(normalizarDireccion('Cl. 68 # 15-30')).toBe('calle 68 15 30');
    expect(normalizarDireccion('Av. Siempre Viva 742')).toBe(
      'avenida siempre viva 742',
    );
    expect(normalizarDireccion('Dg. 45 # 7-20')).toBe('diagonal 45 7 20');
    expect(normalizarDireccion('Tr. 99 # 1-01')).toBe('transversal 99 1 01');
  });

  it('"No."/"Nro." convergen con "#" (ambos significan número)', () => {
    expect(normalizarDireccion('Calle 10 No. 5-20')).toBe(
      normalizarDireccion('Calle 10 # 5-20'),
    );
    expect(normalizarDireccion('Carrera 7 Nro 71-20')).toBe(
      normalizarDireccion('Carrera 7 # 71-20'),
    );
  });

  it('expande complementos (apto, mz, cs, int)', () => {
    expect(normalizarDireccion('Calle 10 # 5-20 Apto 301')).toBe(
      'calle 10 5 20 apartamento 301',
    );
    expect(normalizarDireccion('Mz B Cs 14')).toBe('manzana b casa 14');
  });

  it('direcciones distintas no colapsan', () => {
    expect(normalizarDireccion('Calle 10 # 5-20')).not.toBe(
      normalizarDireccion('Carrera 10 # 5-20'),
    );
    expect(normalizarDireccion('Calle 10 # 5-20')).not.toBe(
      normalizarDireccion('Calle 10 # 5-21'),
    );
  });

  it('maneja valores nulos/vacíos', () => {
    expect(normalizarDireccion(null)).toBe('');
    expect(normalizarDireccion(undefined)).toBe('');
    expect(normalizarDireccion('   ')).toBe('');
  });
});

describe('claveDireccion (I20)', () => {
  it('combina dirección y ciudad normalizadas', () => {
    expect(claveDireccion('Calle 10 # 5-20', 'Bogotá')).toBe(
      'calle 10 5 20|bogota',
    );
  });

  it('misma dirección en ciudades distintas produce claves distintas', () => {
    expect(claveDireccion('Calle 10 # 5-20', 'Bogotá')).not.toBe(
      claveDireccion('Calle 10 # 5-20', 'Medellín'),
    );
  });
});

describe('similitudDireccion (I20)', () => {
  it('idénticas = 1', () => {
    expect(similitudDireccion('calle 10 5 20', 'calle 10 5 20')).toBe(1);
  });

  it('casi-duplicado con tipeo supera el umbral', () => {
    const s = similitudDireccion('carrera 10 5 20', 'carerra 10 5 20');
    expect(s).toBeGreaterThanOrEqual(UMBRAL_SIMILITUD_DIRECCION);
  });

  it('direcciones distintas quedan bajo el umbral', () => {
    const s = similitudDireccion('calle 10 5 20', 'carrera 45 128 30');
    expect(s).toBeLessThan(UMBRAL_SIMILITUD_DIRECCION);
  });

  it('tipos de vía distintos con mismos números quedan bajo el umbral', () => {
    const s = similitudDireccion('calle 10 5 20', 'carrera 10 5 20');
    expect(s).toBeLessThan(UMBRAL_SIMILITUD_DIRECCION);
  });

  it('convierte la letra "o" por cero en tokens numéricos (tipeo 128-3O)', () => {
    expect(normalizarDireccion('Carrera 45 # 128-3O')).toBe(
      'carrera 45 128 30',
    );
  });

  it('vacías: 1 si ambas lo están, 0 si solo una', () => {
    expect(similitudDireccion('', '')).toBe(1);
    expect(similitudDireccion('', 'calle 10')).toBe(0);
  });
});

describe('direccionDuplicada (I20) — el escenario de casi-duplicado sin cobertura previa', () => {
  const conocidas = new Set([
    claveDireccion('Calle 10 # 5-20', 'Bogotá'),
    claveDireccion('Carrera 45 # 128-30', 'Bogotá'),
    claveDireccion('Calle 10 # 5-20', 'Medellín'),
  ]);

  it.each([
    ['calle 10 #5-20', 'espacio distinto tras #'],
    ['CALLE 10 # 5 - 20', 'mayúsculas + guion espaciado'],
    ['Cl. 10 # 5-20.', 'abreviatura Cl. + punto final'],
    ['Calle 10 No. 5-20', 'No. en vez de #'],
    ['Calle  10   # 5-20', 'espacios múltiples'],
    ['Calle 10 # 5-20', 'calle 10 5 20 exacta en minúsculas'],
  ])('detecta "%s" como duplicado (%s)', (dir) => {
    expect(direccionDuplicada(dir, 'Bogotá', conocidas)).toBe(true);
  });

  it('detecta duplicado con error de tipeo por similitud', () => {
    expect(direccionDuplicada('Carrera 45 # 128-3O', 'Bogotá', conocidas)).toBe(
      true,
    );
  });

  it('no descarta una dirección genuinamente distinta', () => {
    expect(direccionDuplicada('Diagonal 7 # 40-15', 'Bogotá', conocidas)).toBe(
      false,
    );
    expect(direccionDuplicada('Calle 11 # 5-20', 'Bogotá', conocidas)).toBe(
      false,
    );
    expect(direccionDuplicada('Carrera 10 # 5-20', 'Bogotá', conocidas)).toBe(
      false,
    );
  });

  it('guardia numérico: mismo texto, número distinto → NO es duplicado', () => {
    // En textos cortos la similitud sola daría falsos positivos aquí.
    expect(direccionDuplicada('Calle 10 # 5-88', 'Bogotá', conocidas)).toBe(
      false,
    );
    expect(direccionDuplicada('Carrera 45 # 128-31', 'Bogotá', conocidas)).toBe(
      false,
    );
  });

  it('guardia numérico: mismo inmueble, oficina distinta → NO es duplicado', () => {
    const conOficina = new Set([
      claveDireccion('Calle 68 # 15-30 Oficina 402', 'Bogotá'),
    ]);
    expect(
      direccionDuplicada('Calle 68 # 15-30 Oficina 403', 'Bogotá', conOficina),
    ).toBe(false);
    expect(
      direccionDuplicada('Calle 68 # 15-30 Of. 402', 'Bogotá', conOficina),
    ).toBe(true);
  });

  it('misma dirección en otra ciudad NO es duplicado', () => {
    expect(direccionDuplicada('Carrera 45 # 128-30', 'Cali', conocidas)).toBe(
      false,
    );
  });

  it('la ciudad también se normaliza al comparar', () => {
    expect(direccionDuplicada('Calle 10 # 5-20', 'bogotá ', conocidas)).toBe(
      true,
    );
    expect(direccionDuplicada('Calle 10 # 5-20', 'MEDELLÍN', conocidas)).toBe(
      true,
    );
  });
});
