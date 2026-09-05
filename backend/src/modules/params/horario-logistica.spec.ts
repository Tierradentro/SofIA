import {
  descripcionHorario,
  diaYMinutosEnZona,
  estaEnHorarioLogistica,
  HORARIO_LOGISTICA_DEFAULT,
  HorarioLogistica,
} from './horario-logistica';

/**
 * I36: horario de logística como control de acceso. Las pruebas fijan fechas
 * UTC y verifican la interpretación en la zona horaria configurada.
 */
describe('horario de logística (I36)', () => {
  const cfgBase: HorarioLogistica = {
    activo: true,
    dias: [1, 2, 3, 4, 5, 6], // lunes a sábado
    horaInicio: '06:00',
    horaFin: '18:00',
    zonaHoraria: 'America/Bogota', // UTC-5, sin horario de verano
  };

  it('desactivado → siempre permite el acceso', () => {
    const cfg = { ...cfgBase, activo: false };
    // Domingo 3 a. m. en Bogotá: fuera de cualquier horario razonable.
    expect(estaEnHorarioLogistica(cfg, new Date('2026-08-30T08:00:00Z'))).toBe(true);
  });

  it('dentro de la franja y día permitido → permite', () => {
    // Lunes 31 ago 2026, 10:00 Bogotá (15:00Z).
    expect(estaEnHorarioLogistica(cfgBase, new Date('2026-08-31T15:00:00Z'))).toBe(true);
  });

  it('antes de la hora de inicio → niega', () => {
    // Lunes 5:59 Bogotá (10:59Z).
    expect(estaEnHorarioLogistica(cfgBase, new Date('2026-08-31T10:59:00Z'))).toBe(false);
    // Lunes 6:00 en punto → permitido.
    expect(estaEnHorarioLogistica(cfgBase, new Date('2026-08-31T11:00:00Z'))).toBe(true);
  });

  it('a la hora de cierre o después → niega', () => {
    // Lunes 18:00 Bogotá (23:00Z) — la franja es [inicio, fin).
    expect(estaEnHorarioLogistica(cfgBase, new Date('2026-08-31T23:00:00Z'))).toBe(false);
    // Lunes 17:59 → permitido.
    expect(estaEnHorarioLogistica(cfgBase, new Date('2026-08-31T22:59:00Z'))).toBe(true);
  });

  it('día no permitido (domingo) → niega aunque la hora sea válida', () => {
    // Domingo 30 ago 2026, 10:00 Bogotá (15:00Z).
    expect(estaEnHorarioLogistica(cfgBase, new Date('2026-08-30T15:00:00Z'))).toBe(false);
    // Sábado sí está en la lista.
    expect(estaEnHorarioLogistica(cfgBase, new Date('2026-08-29T15:00:00Z'))).toBe(true);
  });

  it('franja que cruza medianoche (18:00–06:00) → permite de noche y madrugada', () => {
    const cfgNoche = { ...cfgBase, dias: [1], horaInicio: '18:00', horaFin: '06:00' };
    // Lunes 20:00 Bogotá (mar 01:00Z).
    expect(estaEnHorarioLogistica(cfgNoche, new Date('2026-09-01T01:00:00Z'))).toBe(true);
    // Martes 03:00 Bogotá (08:00Z): la franja abierta el lunes sigue vigente…
    // nota: la validación de día usa el día local de la fecha; martes no está
    // en la lista, así que niega aunque la hora caiga en la franja.
    expect(estaEnHorarioLogistica(cfgNoche, new Date('2026-09-01T08:00:00Z'))).toBe(false);
    // Lunes 12:00 (mediodía) → fuera de la franja nocturna.
    expect(estaEnHorarioLogistica(cfgNoche, new Date('2026-08-31T17:00:00Z'))).toBe(false);
  });

  it('zona horaria inválida cae en la por defecto sin romperse', () => {
    const cfg = { ...cfgBase, zonaHoraria: 'Zona/Inventada' };
    expect(() => estaEnHorarioLogistica(cfg, new Date('2026-08-31T15:00:00Z'))).not.toThrow();
    expect(estaEnHorarioLogistica(cfg, new Date('2026-08-31T15:00:00Z'))).toBe(true);
  });

  it('diaYMinutosEnZona interpreta la hora local de la zona', () => {
    // 15:30Z = 10:30 en Bogotá (UTC-5), lunes (día 1).
    const r = diaYMinutosEnZona(new Date('2026-08-31T15:30:00Z'), 'America/Bogota');
    expect(r.dia).toBe(1);
    expect(r.minutos).toBe(10 * 60 + 30);
  });

  it('valores por defecto: control desactivado, lunes a sábado 06:00–18:00 Bogotá', () => {
    expect(HORARIO_LOGISTICA_DEFAULT.activo).toBe(false);
    expect(HORARIO_LOGISTICA_DEFAULT.dias).toEqual([1, 2, 3, 4, 5, 6]);
    expect(HORARIO_LOGISTICA_DEFAULT.zonaHoraria).toBe('America/Bogota');
  });

  it('descripcionHorario resume días y franja para el mensaje de rechazo', () => {
    expect(descripcionHorario(cfgBase)).toBe('lun, mar, mié, jue, vie, sáb de 06:00 a 18:00');
  });
});
