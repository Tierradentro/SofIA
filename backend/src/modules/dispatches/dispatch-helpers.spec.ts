import {
  calcularPendiente,
  formatBoxId,
  formatNumeroDespacho,
} from './dispatch-helpers';

describe('dispatch-helpers (M09)', () => {
  describe('formatNumeroDespacho — DES-###### global (B-1, spec v1.1)', () => {
    it('formatea con prefijo DES y 6 dígitos', () => {
      expect(formatNumeroDespacho(1)).toBe('DES-000001');
      expect(formatNumeroDespacho(42)).toBe('DES-000042');
      expect(formatNumeroDespacho(1234567)).toBe('DES-1234567');
    });

    it('rechaza consecutivos menores que 1', () => {
      expect(() => formatNumeroDespacho(0)).toThrow();
      expect(() => formatNumeroDespacho(-1)).toThrow();
    });
  });

  describe('formatBoxId — CJA-###### global (contenido del QR)', () => {
    it('formatea con prefijo CJA y 6 dígitos', () => {
      expect(formatBoxId(1)).toBe('CJA-000001');
      expect(formatBoxId(999)).toBe('CJA-000999');
      expect(formatBoxId(1234567)).toBe('CJA-1234567');
    });

    it('rechaza consecutivos menores que 1', () => {
      expect(() => formatBoxId(0)).toThrow();
    });
  });

  describe('calcularPendiente', () => {
    it('alistada − despachada − en cajas abiertas', () => {
      expect(calcularPendiente(10, 0, 0)).toBe(10);
      expect(calcularPendiente(10, 4, 0)).toBe(6);
      expect(calcularPendiente(10, 4, 3)).toBe(3);
      expect(calcularPendiente(10, 10, 0)).toBe(0);
    });
  });
});
