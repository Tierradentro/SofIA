/** Resultado de comparar la factura de venta contra el pedido (HU-032). */
export interface InvoiceDifference {
  codigo: string;
  cantidadPedida: number;
  cantidadFacturada: number;
  tipo: 'FALTANTE_EN_FACTURA' | 'CANTIDAD_DIFERENTE' | 'EXTRA_EN_FACTURA';
}

/**
 * HU-032 / M08 paso 4: comparación estricta pedido vs. factura de venta.
 * Confirmación total solo si cada producto del pedido aparece en la factura
 * con la misma cantidad y no hay productos extra. Con diferencias se reporta
 * el error y el pedido NO puede cambiar de estado.
 */
export function compararFacturaConPedido(
  itemsPedido: { codigo: string; cantidad: number }[],
  itemsFactura: { codigo: string; cantidad: number }[],
): InvoiceDifference[] {
  const diferencias: InvoiceDifference[] = [];
  const facturaPorCodigo = new Map<string, number>();
  for (const f of itemsFactura) {
    const clave = f.codigo.trim().toUpperCase();
    facturaPorCodigo.set(clave, (facturaPorCodigo.get(clave) ?? 0) + f.cantidad);
  }
  const pedidoPorCodigo = new Map<string, number>();
  for (const p of itemsPedido) {
    const clave = p.codigo.trim().toUpperCase();
    pedidoPorCodigo.set(clave, (pedidoPorCodigo.get(clave) ?? 0) + p.cantidad);
  }
  for (const [codigo, pedida] of pedidoPorCodigo) {
    const facturada = facturaPorCodigo.get(codigo);
    if (facturada === undefined) {
      diferencias.push({ codigo, cantidadPedida: pedida, cantidadFacturada: 0, tipo: 'FALTANTE_EN_FACTURA' });
    } else if (facturada !== pedida) {
      diferencias.push({ codigo, cantidadPedida: pedida, cantidadFacturada: facturada, tipo: 'CANTIDAD_DIFERENTE' });
    }
  }
  for (const [codigo, facturada] of facturaPorCodigo) {
    if (!pedidoPorCodigo.has(codigo)) {
      diferencias.push({ codigo, cantidadPedida: 0, cantidadFacturada: facturada, tipo: 'EXTRA_EN_FACTURA' });
    }
  }
  return diferencias;
}
