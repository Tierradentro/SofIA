import {
  calcularDiferencia,
  formatNumeroInventario,
  valorEstimadoDiferencia,
} from './inventory-helpers';

describe('inventory-helpers (M12)', () => {
  describe('formatNumeroInventario — INV-SIGLAS-#### por empresa', () => {
    it('formatea con prefijo INV, siglas y 4 dígitos', () => {
      expect(formatNumeroInventario('IRE', 1)).toBe('INV-IRE-0001');
      expect(formatNumeroInventario('ICV', 12)).toBe('INV-ICV-0012');
      expect(formatNumeroInventario('ire', 3)).toBe('INV-IRE-0003');
    });

    it('rechaza consecutivos menores que 1', () => {
      expect(() => formatNumeroInventario('IRE', 0)).toThrow();
    });
  });

  describe('calcularDiferencia (HU-050)', () => {
    it('Conteo − Existencia snapshot', () => {
      expect(calcularDiferencia(10, 10)).toBe(0);
      expect(calcularDiferencia(12, 10)).toBe(2);
      expect(calcularDiferencia(7, 10)).toBe(-3);
    });
  });

  describe('valorEstimadoDiferencia (HU-050)', () => {
    it('diferencia × precio snapshot', () => {
      expect(valorEstimadoDiferencia(2, 5000)).toBe(10000);
      expect(valorEstimadoDiferencia(-3, 5000)).toBe(-15000);
      expect(valorEstimadoDiferencia(0, 5000)).toBe(0);
    });
  });
});
