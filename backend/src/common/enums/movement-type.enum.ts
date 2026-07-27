/**
 * Tipos de movimiento de inventario (D-01). Toda variación de existencias
 * (Cantidad y Cantidad bloqueada) se origina en uno de estos movimientos;
 * nunca por edición directa del campo (regla transversal).
 */
export enum MovementType {
  INGRESO_APROBADO = 'INGRESO_APROBADO',
  BLOQUEO_ALISTAMIENTO = 'BLOQUEO_ALISTAMIENTO',
  LIBERACION_BLOQUEO = 'LIBERACION_BLOQUEO',
  DESPACHO_CIERRE_CAJA = 'DESPACHO_CIERRE_CAJA',
  AJUSTE_INVENTARIO = 'AJUSTE_INVENTARIO',
  AJUSTE_IMPORTACION = 'AJUSTE_IMPORTACION',
  REINGRESO_DEVOLUCION = 'REINGRESO_DEVOLUCION',
  CORRECCION_ADMIN = 'CORRECCION_ADMIN',
}
