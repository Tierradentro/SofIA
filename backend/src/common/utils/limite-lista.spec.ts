import { parseLimiteLista } from './limite-lista';

describe('parseLimiteLista (I43)', () => {
  it('sin parámetro conserva el tope por defecto del servicio', () => {
    expect(parseLimiteLista(undefined)).toBeUndefined();
    expect(parseLimiteLista('')).toBeUndefined();
  });

  it('0 o «todos» quitan el tope', () => {
    expect(parseLimiteLista('0')).toBe(0);
    expect(parseLimiteLista('todos')).toBe(0);
  });

  it('admite 100 y 500 tal cual', () => {
    expect(parseLimiteLista('100')).toBe(100);
    expect(parseLimiteLista('500')).toBe(500);
  });

  it('acota a 5000 como protección', () => {
    expect(parseLimiteLista('999999')).toBe(5000);
  });

  it('valores inválidos vuelven al comportamiento por defecto', () => {
    expect(parseLimiteLista('abc')).toBeUndefined();
    expect(parseLimiteLista('-5')).toBeUndefined();
  });
});
