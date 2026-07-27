import { sanitize } from './audit.service';

describe('AuditService.sanitize — nunca registra datos sensibles', () => {
  it('enmascara passwordHash y variantes', () => {
    const out = sanitize({
      id: '1',
      passwordHash: '$2a$10$xxx',
      password: 'secreto',
      nested: { clave: 'abc', apiKey: 'k-123' },
    });
    expect(out.passwordHash).toBe('***');
    expect(out.password).toBe('***');
    expect(out.nested.clave).toBe('***');
    expect(out.nested.apiKey).toBe('***');
    expect(out.id).toBe('1');
  });

  it('conserva valores normales y nulos', () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize({ nombre: 'IRE', activo: true })).toEqual({
      nombre: 'IRE',
      activo: true,
    });
  });
});
