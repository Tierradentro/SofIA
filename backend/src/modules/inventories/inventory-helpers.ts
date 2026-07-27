/**
 * Funciones puras del módulo de inventarios (M12).
 */

/** Consecutivo de jornada INV-SIGLAS-#### (serie por empresa). */
export function formatNumeroInventario(siglas: string, n: number): string {
  if (n < 1 || !Number.isInteger(n)) throw new Error('El consecutivo inicia en 1');
  return `INV-${siglas.trim().toUpperCase()}-${String(n).padStart(4, '0')}`;
}

/** HU-050: Diferencia = Conteo − Existencia (snapshot). */
export function calcularDiferencia(conteo: number, existenciaSnapshot: number): number {
  return conteo - existenciaSnapshot;
}

/** HU-050: valor estimado de la diferencia (diferencia × precio snapshot). */
export function valorEstimadoDiferencia(diferencia: number, precioSnapshot: number): number {
  return diferencia * precioSnapshot;
}
