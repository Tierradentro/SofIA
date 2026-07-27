/**
 * Funciones puras del módulo de despachos (M09).
 */

/**
 * Consecutivo de despacho GLOBAL DES-###### (B-1, spec v1.1 M08 §2 / M09 §3:
 * serie única y compartida por todas las empresas).
 */
export function formatNumeroDespacho(n: number): string {
  if (n < 1 || !Number.isInteger(n)) throw new Error('El consecutivo inicia en 1');
  return `DES-${String(n).padStart(6, '0')}`;
}

/** boxId GLOBAL CJA-###### (único para todas las empresas; contenido del QR). */
export function formatBoxId(n: number): string {
  if (n < 1 || !Number.isInteger(n)) throw new Error('El consecutivo de caja inicia en 1');
  return `CJA-${String(n).padStart(6, '0')}`;
}

/**
 * Pendiente por empacar de una línea de pedido dentro de un despacho:
 * lo alistado menos lo ya despachado (cajas cerradas) menos lo contado
 * en cajas aún abiertas de este despacho.
 */
export function calcularPendiente(
  cantidadAlistada: number,
  cantidadDespachada: number,
  enCajasAbiertas: number,
): number {
  return cantidadAlistada - cantidadDespachada - enCajasAbiertas;
}
