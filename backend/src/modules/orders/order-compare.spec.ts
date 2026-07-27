import { compararFacturaConPedido } from './order-compare';

/** HU-032: comparación estricta pedido vs. factura de venta. */
describe('compararFacturaConPedido', () => {
  it('confirmación total cuando coinciden productos y cantidades', () => {
    const d = compararFacturaConPedido(
      [{ codigo: 'A-1', cantidad: 3 }, { codigo: 'B-2', cantidad: 2 }],
      [{ codigo: 'B-2', cantidad: 2 }, { codigo: 'A-1', cantidad: 3 }],
    );
    expect(d).toHaveLength(0);
  });

  it('detecta producto faltante en factura', () => {
    const d = compararFacturaConPedido(
      [{ codigo: 'A-1', cantidad: 3 }, { codigo: 'B-2', cantidad: 2 }],
      [{ codigo: 'A-1', cantidad: 3 }],
    );
    expect(d).toEqual([
      { codigo: 'B-2', cantidadPedida: 2, cantidadFacturada: 0, tipo: 'FALTANTE_EN_FACTURA' },
    ]);
  });

  it('detecta cantidad diferente y producto extra', () => {
    const d = compararFacturaConPedido(
      [{ codigo: 'A-1', cantidad: 3 }],
      [{ codigo: 'A-1', cantidad: 5 }, { codigo: 'X-9', cantidad: 1 }],
    );
    expect(d).toContainEqual({ codigo: 'A-1', cantidadPedida: 3, cantidadFacturada: 5, tipo: 'CANTIDAD_DIFERENTE' });
    expect(d).toContainEqual({ codigo: 'X-9', cantidadPedida: 0, cantidadFacturada: 1, tipo: 'EXTRA_EN_FACTURA' });
  });

  it('agrega cantidades por código (líneas repetidas, case-insensitive)', () => {
    const d = compararFacturaConPedido(
      [{ codigo: 'a-1', cantidad: 2 }, { codigo: 'A-1', cantidad: 3 }],
      [{ codigo: 'A-1', cantidad: 5 }],
    );
    expect(d).toHaveLength(0);
  });
});
