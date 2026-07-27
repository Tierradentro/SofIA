/**
 * Tipos de documento gestionados (D-07). Facturas de importación y de venta
 * son permanentes (soporte de aprobación); órdenes, cotizaciones y guías son
 * temporales (M13). Los soportes PQRS se almacenan (M11).
 */
export enum DocumentType {
  FACTURA_IMPORTACION = 'FACTURA_IMPORTACION',
  ORDEN_PEDIDO = 'ORDEN_PEDIDO',
  COTIZACION = 'COTIZACION',
  FACTURA_VENTA = 'FACTURA_VENTA',
  GUIA_TRANSPORTE = 'GUIA_TRANSPORTE',
  SOPORTE_PQRS = 'SOPORTE_PQRS',
  LOGO = 'LOGO',
}

/** Tipos que no pueden eliminarse una vez almacenados (permanentes). */
export const PERMANENT_DOCUMENT_TYPES = [
  DocumentType.FACTURA_IMPORTACION,
  DocumentType.FACTURA_VENTA,
  DocumentType.SOPORTE_PQRS,
  DocumentType.LOGO,
];
