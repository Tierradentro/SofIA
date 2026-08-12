import { BadRequestException } from '@nestjs/common';

/**
 * Regla de factura del caso PQRS (HU-045, CU-007):
 * - Si el pedido asociado tiene factura, se usa esa (automática).
 * - Si no hay coincidencia, la factura digitada es MANUAL.
 * - Sin factura ni pedido, la observación es obligatoria.
 */
export function resolverFacturaCaso(params: {
  facturaDigitada?: string | null;
  facturaPedido?: string | null;
  observacion?: string | null;
}): { factura: string | null; facturaManual: boolean } {
  const digitada = params.facturaDigitada?.trim() || null;
  const delPedido = params.facturaPedido?.trim() || null;

  if (delPedido && !digitada) {
    return { factura: delPedido, facturaManual: false };
  }
  if (digitada) {
    return { factura: digitada, facturaManual: digitada !== delPedido };
  }
  if (!params.observacion?.trim()) {
    throw new BadRequestException(
      'Sin factura ni pedido asociado, la observación de la factura es obligatoria',
    );
  }
  return { factura: null, facturaManual: false };
}

/** Unidades reingresables al inventario (no exceder lo devuelto). */
export function validarReingreso(
  cantidadCaso: number,
  cantidadReingresada: number,
  solicitada: number,
): void {
  if (solicitada <= 0) {
    throw new BadRequestException('Nada pendiente por reingresar');
  }
  if (cantidadReingresada + solicitada > cantidadCaso) {
    throw new BadRequestException(
      `Excede lo devuelto: caso de ${cantidadCaso} unidades, ya reingresadas ${cantidadReingresada}`,
    );
  }
}
