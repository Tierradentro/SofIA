import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UserStatus } from '../../common/enums/user-status.enum';
import { Role } from '../../common/enums/role.enum';

const POLICY = {
  min_length: 6,
  require_uppercase: true,
  require_lowercase: true,
  require_number: true,
  expiration_days: 60,
  max_failed_attempts: 5,
};

function buildUser(overrides: Partial<any> = {}) {
  return {
    id: 'u1',
    username: 'operador1',
    nombre: 'Operador Uno',
    rol: Role.OPERADOR,
    estado: UserStatus.ACTIVO,
    passwordHash: bcrypt.hashSync('Clave123', 4),
    fechaClave: new Date(),
    debeCambiarClave: false,
    intentosFallidos: 0,
    ...overrides,
  };
}

describe('AuthService — login (HU-001, M02)', () => {
  let repo: any;
  let service: AuthService;
  let auditLogs: any[];

  beforeEach(() => {
    auditLogs = [];
    repo = {
      findOne: jest.fn(),
      save: jest.fn(async (u) => u),
    };
    const jwt = { sign: () => 'token-falso' } as any;
    const params = { getPasswordPolicy: async () => POLICY } as any;
    const policy = new (require('./password-policy.service').PasswordPolicyService)(params);
    const blacklist = { revoke: jest.fn(), isRevoked: jest.fn() } as any;
    const audit = { log: async (e: any) => auditLogs.push(e) } as any;
    service = new AuthService(repo, jwt, params, policy, blacklist, audit);
  });

  it('credenciales inválidas: mensaje genérico sin revelar información (HU-001)', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.login('noexiste', 'x')).rejects.toThrow(
      new UnauthorizedException('Usuario o contraseña incorrectos'),
    );
  });

  it('mismo mensaje para usuario inexistente, bloqueado y clave errada', async () => {
    repo.findOne.mockResolvedValue(buildUser({ estado: UserStatus.BLOQUEADO }));
    const errBloqueado = await service.login('operador1', 'Clave123').catch((e) => e.message);

    repo.findOne.mockResolvedValue(buildUser());
    const errClave = await service.login('operador1', 'mala').catch((e) => e.message);

    repo.findOne.mockResolvedValue(null);
    const errInexistente = await service.login('nadie', 'x').catch((e) => e.message);

    expect(errBloqueado).toBe(errClave);
    expect(errClave).toBe(errInexistente);
  });

  it('bloquea al quinto intento fallido y lo audita (M02)', async () => {
    const user = buildUser({ intentosFallidos: 4 });
    repo.findOne.mockResolvedValue(user);
    await expect(service.login('operador1', 'mala')).rejects.toThrow(
      UnauthorizedException,
    );
    expect(user.estado).toBe(UserStatus.BLOQUEADO);
    const logBloqueo = auditLogs.find((l) => l.accion === 'USUARIO_BLOQUEADO_INTENTOS');
    expect(logBloqueo).toBeDefined();
    expect(logBloqueo.valorNuevo.estado).toBe(UserStatus.BLOQUEADO);
  });

  it('login exitoso: resetea intentos, marca clave expirada y audita LOGIN', async () => {
    const hace90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const user = buildUser({ intentosFallidos: 2, fechaClave: hace90 });
    repo.findOne.mockResolvedValue(user);
    const res = await service.login('operador1', 'Clave123');
    expect(res.access_token).toBe('token-falso');
    expect(user.intentosFallidos).toBe(0);
    expect(user.debeCambiarClave).toBe(true); // expirada (60 días)
    expect(auditLogs.some((l) => l.accion === 'LOGIN')).toBe(true);
  });
});
