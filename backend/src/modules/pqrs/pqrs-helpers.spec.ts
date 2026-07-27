import { resolverFacturaCaso, validarReingreso } from './pqrs-helpers';

describe('pqrs-helpers (M11)', () => {
  describe('resolverFacturaCaso (HU-045 / CU-007)', () => {
    it('usa la factura del pedido asociado cuando no se digitó otra', () => {
      expect(
        resolverFacturaCaso({ facturaPedido: 'FV-2026-0007' }),
      ).toEqual({ factura: 'FV-2026-0007', facturaManual: false });
    });

    it('la factura digitada sin coincidencia es manual', () => {
      expect(
        resolverFacturaCaso({ facturaDigitada: 'FV-EXT-100' }),
      ).toEqual({ factura: 'FV-EXT-100', facturaManual: true });
    });

    it('la digitada igual a la del pedido no es manual', () => {
      expect(
        resolverFacturaCaso({ facturaDigitada: 'FV-1', facturaPedido: 'FV-1' }),
      ).toEqual({ factura: 'FV-1', facturaManual: false });
    });

    it('sin factura ni pedido exige observación (CU-007)', () => {
      expect(() => resolverFacturaCaso({})).toThrow(/observación/);
      expect(
        resolverFacturaCaso({ observacion: 'Cliente no tenía la factura' }),
      ).toEqual({ factura: null, facturaManual: false });
    });
  });

  describe('validarReingreso', () => {
    it('permite reingresar hasta lo devuelto', () => {
      expect(() => validarReingreso(5, 0, 5)).not.toThrow();
      expect(() => validarReingreso(5, 3, 2)).not.toThrow();
    });

    it('rechaza excedentes y cantidades no positivas', () => {
      expect(() => validarReingreso(5, 4, 2)).toThrow(/Excede/);
      expect(() => validarReingreso(5, 5, 1)).toThrow(/Excede/);
      expect(() => validarReingreso(5, 5, 0)).toThrow(/pendiente/);
    });
  });
});
