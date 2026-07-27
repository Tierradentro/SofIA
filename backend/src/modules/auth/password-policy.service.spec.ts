import { PasswordPolicyService } from './password-policy.service';
import { PasswordPolicy } from '../params/params.service';

const POLICY: PasswordPolicy = {
  min_length: 6,
  require_uppercase: true,
  require_lowercase: true,
  require_number: true,
  expiration_days: 60,
  max_failed_attempts: 5,
};

describe('PasswordPolicyService (Spec M02)', () => {
  const service = new PasswordPolicyService(null as any);

  it('acepta una clave conforme (min 6, mayúscula, minúscula, número)', () => {
    expect(service.check('Abcdef1', POLICY)).toEqual([]);
  });

  it('rechaza clave corta', () => {
    expect(service.check('Ab1', POLICY)).toContain('Mínimo 6 caracteres');
  });

  it('rechaza sin mayúscula', () => {
    const e = service.check('abcdef1', POLICY);
    expect(e).toContain('Debe incluir al menos una mayúscula');
  });

  it('rechaza sin minúscula', () => {
    const e = service.check('ABCDEF1', POLICY);
    expect(e).toContain('Debe incluir al menos una minúscula');
  });

  it('rechaza sin número', () => {
    const e = service.check('Abcdefg', POLICY);
    expect(e).toContain('Debe incluir al menos un número');
  });

  it('detecta clave expirada a los 60 días', () => {
    const hace61 = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000);
    const hace10 = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    expect(service.isExpired(hace61, POLICY)).toBe(true);
    expect(service.isExpired(hace10, POLICY)).toBe(false);
  });
});
