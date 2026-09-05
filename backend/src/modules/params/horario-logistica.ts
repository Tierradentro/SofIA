/**
 * I36: horario de logística como control de acceso a la aplicación.
 *
 * El Administrador configura los días de la semana y la franja horaria en que
 * los roles operativos pueden usar la aplicación (parámetro del sistema
 * `logistica.horario_acceso`). Fuera de ese horario, el guard global y el
 * login rechazan el acceso con 403 FUERA_DE_HORARIO y un mensaje claro.
 * El Administrador y las integraciones por API key no se ven afectados.
 */

export interface HorarioLogistica {
  /** false = control desactivado (acceso 24/7, valor por defecto). */
  activo: boolean;
  /** Días permitidos: 0 = domingo … 6 = sábado. */
  dias: number[];
  /** 'HH:MM' (24 h). */
  horaInicio: string;
  /** 'HH:MM' (24 h). Si es mayor que horaInicio, la franja cruza medianoche. */
  horaFin: string;
  /** Zona horaria IANA en que se interpretan los horarios. */
  zonaHoraria: string;
}

export const HORARIO_LOGISTICA_DEFAULT: HorarioLogistica = {
  activo: false,
  dias: [1, 2, 3, 4, 5, 6],
  horaInicio: '06:00',
  horaFin: '18:00',
  zonaHoraria: 'America/Bogota',
};

const DIAS_SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Día de la semana (0-6) y minutos del día de una fecha en una zona horaria. */
export function diaYMinutosEnZona(fecha: Date, zonaHoraria: string): { dia: number; minutos: number } {
  let zona = zonaHoraria || HORARIO_LOGISTICA_DEFAULT.zonaHoraria;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zona });
  } catch {
    zona = HORARIO_LOGISTICA_DEFAULT.zonaHoraria;
  }
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(fecha);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  const dia = DIAS_SEMANA.indexOf(valor('weekday'));
  // Intl puede devolver hour '24' a medianoche; se normaliza a 0.
  const hora = Number(valor('hour')) % 24;
  return { dia, minutos: hora * 60 + Number(valor('minute')) };
}

function aMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Indica si `fecha` cae dentro del horario permitido. Con el control
 * desactivado (activo=false) siempre devuelve true.
 */
export function estaEnHorarioLogistica(cfg: HorarioLogistica, fecha = new Date()): boolean {
  if (!cfg.activo) return true;
  const { dia, minutos } = diaYMinutosEnZona(fecha, cfg.zonaHoraria);
  if (!cfg.dias.includes(dia)) return false;
  const inicio = aMinutos(cfg.horaInicio);
  const fin = aMinutos(cfg.horaFin);
  if (inicio === fin) return false;
  // Franja normal (06:00–18:00) o que cruza medianoche (18:00–06:00).
  return inicio < fin ? minutos >= inicio && minutos < fin : minutos >= inicio || minutos < fin;
}

/** Texto corto para los mensajes de rechazo (sin exponer datos internos). */
export function descripcionHorario(cfg: HorarioLogistica): string {
  const nombres = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const dias = [...cfg.dias].sort((a, b) => a - b).map((d) => nombres[d] ?? d);
  return `${dias.join(', ')} de ${cfg.horaInicio} a ${cfg.horaFin}`;
}
