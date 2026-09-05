/**
 * I36: tiempo transcurrido en lenguaje natural con escala progresiva:
 * minutos (<1 h), horas (<24 h), días (<30 días) y meses a partir de ahí.
 * Se usa en las fichas de pedidos y en el monitor del dashboard.
 */
export function tiempoRelativo(fechaIso: string): string {
  const ms = Date.now() - new Date(fechaIso).getTime();
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.floor(horas / 24);
  if (dias < 30) return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`;
  const meses = Math.floor(dias / 30);
  return `hace ${meses} ${meses === 1 ? 'mes' : 'meses'}`;
}
