export type InvoiceComparator = (
  codigoPedido: string,
  codigoFactura: string,
) => boolean;

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
  esMismoCodigo: InvoiceComparator = (a, b) =>
    a.trim().toUpperCase() === b.trim().toUpperCase(),
): InvoiceDifference[] {
  const diferencias: InvoiceDifference[] = [];
  // I64: la cantidad facturada se acumula por EQUIVALENCIA de código — un
  // producto que aparezca dos veces en la factura con referencias distintas
  // (p. ej. una completa y otra truncada por World Office) suma una sola vez
  // contra el pedido. Con el comparador por defecto (igualdad) el
  // comportamiento es el de siempre.
  const facturaPorCodigo = new Map<string, number>();
  for (const f of itemsFactura) {
    const clave = f.codigo.trim().toUpperCase();
    const existente = [...facturaPorCodigo.keys()].find((k) => esMismoCodigo(k, clave));
    if (existente !== undefined) {
      facturaPorCodigo.set(existente, facturaPorCodigo.get(existente)! + f.cantidad);
    } else {
      facturaPorCodigo.set(clave, f.cantidad);
    }
  }
  const pedidoPorCodigo = new Map<string, number>();
  for (const p of itemsPedido) {
    const clave = p.codigo.trim().toUpperCase();
    pedidoPorCodigo.set(clave, (pedidoPorCodigo.get(clave) ?? 0) + p.cantidad);
  }
  const encontrarFacturada = (codigo: string): number | undefined => {
    if (facturaPorCodigo.has(codigo)) return facturaPorCodigo.get(codigo);
    const eq = [...facturaPorCodigo.keys()].find((k) => esMismoCodigo(k, codigo));
    return eq === undefined ? undefined : facturaPorCodigo.get(eq);
  };
  for (const [codigo, pedida] of pedidoPorCodigo) {
    const facturada = encontrarFacturada(codigo);
    if (facturada === undefined) {
      diferencias.push({ codigo, cantidadPedida: pedida, cantidadFacturada: 0, tipo: 'FALTANTE_EN_FACTURA' });
    } else if (facturada !== pedida) {
      diferencias.push({ codigo, cantidadPedida: pedida, cantidadFacturada: facturada, tipo: 'CANTIDAD_DIFERENTE' });
    }
  }
  for (const [codigo, facturada] of facturaPorCodigo) {
    const enPedido =
      pedidoPorCodigo.has(codigo) ||
      [...pedidoPorCodigo.keys()].some((k) => esMismoCodigo(k, codigo));
    if (!enPedido) {
      diferencias.push({ codigo, cantidadPedida: 0, cantidadFacturada: facturada, tipo: 'EXTRA_EN_FACTURA' });
    }
  }
  return diferencias;
}
