/**
 * I43: las vistas con listas ofrecen mostrar 100, 500 o todos los registros.
 * El parámetro de consulta `limite` se interpreta así:
 *  - ausente → undefined (cada servicio conserva su tope histórico);
 *  - "0" o "todos" → 0 (sin tope);
 *  - entero positivo → ese tope, acotado a 5000 como protección.
 */
export function parseLimiteLista(raw?: string): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (raw === 'todos') return 0;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return undefined;
  if (n === 0) return 0;
  return Math.min(5000, n);
}

/**
 * I56: número de página (1-based) para las listas paginadas. Ausente o
 * inválido → 1. Con limite=0 («Todos») la paginación no aplica.
 */
export function parsePaginaLista(raw?: string): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (Number.isNaN(n) || n < 1) return 1;
  return Math.min(100000, n);
}
