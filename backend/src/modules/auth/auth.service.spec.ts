import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';
import { UserStatus } from '../../common/enums/user-status.enum';
import { Role } from '../../common/enums/role.enum';
import { DeviceEstado } from '../devices/entities/device.entity';

/** I57: huella de navegador de prueba. */
const DISP = { deviceId: 'disp-test-0001', nombre: 'Chrome · Linux' };

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
  let devices: any;

  beforeEach(() => {
    auditLogs = [];
    repo = {
      findOne: jest.fn(),
      save: jest.fn(async (u) => u),
    };
    const jwt = { sign: () => 'token-falso' } as any;
    // I36: getHorarioLogistica desactivado por defecto (no restringe el login)
    const params = {
      getPasswordPolicy: async () => POLICY,
      getHorarioLogistica: async () => ({
        activo: false,
        dias: [1, 2, 3, 4, 5, 6],
        horaInicio: '06:00',
        horaFin: '18:00',
        zonaHoraria: 'America/Bogota',
      }),
    } as any;
    const policy = new (require('./password-policy.service').PasswordPolicyService)(params);
    const blacklist = { revoke: jest.fn(), isRevoked: jest.fn() } as any;
    const audit = { log: async (e: any) => auditLogs.push(e) } as any;
    // I57: dispositivo aprobado por defecto en los casos existentes
    devices = {
      registrarEnLogin: jest.fn(async () => ({ id: 'd1', estado: DeviceEstado.APROBADO })),
    } as any;
    service = new AuthService(repo, jwt, params, policy, blacklist, audit, devices);
  });

  it('credenciales inválidas: mensaje genérico sin revelar información (HU-001)', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.login('noexiste', 'x', DISP)).rejects.toThrow(
      new UnauthorizedException('Usuario o contraseña incorrectos'),
    );
  });

  it('mismo mensaje para usuario inexistente, bloqueado y clave errada', async () => {
    repo.findOne.mockResolvedValue(buildUser({ estado: UserStatus.BLOQUEADO }));
    const errBloqueado = await service.login('operador1', 'Clave123', DISP).catch((e) => e.message);

    repo.findOne.mockResolvedValue(buildUser());
    const errClave = await service.login('operador1', 'mala', DISP).catch((e) => e.message);

    repo.findOne.mockResolvedValue(null);
    const errInexistente = await service.login('nadie', 'x', DISP).catch((e) => e.message);

    expect(errBloqueado).toBe(errClave);
    expect(errClave).toBe(errInexistente);
  });

  it('bloquea al quinto intento fallido y lo audita (M02)', async () => {
    const user = buildUser({ intentosFallidos: 4 });
    repo.findOne.mockResolvedValue(user);
    await expect(service.login('operador1', 'mala', DISP)).rejects.toThrow(
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
    const res = await service.login('operador1', 'Clave123', DISP);
    expect((res as any).access_token).toBe('token-falso');
    expect(user.intentosFallidos).toBe(0);
    expect(user.debeCambiarClave).toBe(true); // expirada (60 días)
    expect(auditLogs.some((l) => l.accion === 'LOGIN')).toBe(true);
  });

  it('I57: navegador no autorizado → sin token, responde el estado y audita', async () => {
    const user = buildUser();
    repo.findOne.mockResolvedValue(user);
    devices.registrarEnLogin.mockResolvedValue({ id: 'd2', estado: DeviceEstado.PENDIENTE });
    const res = await service.login('operador1', 'Clave123', DISP);
    expect(res).toEqual({ dispositivoAutorizado: false, estadoDispositivo: DeviceEstado.PENDIENTE });
    expect(devices.registrarEnLogin).toHaveBeenCalledWith(DISP, user, undefined);
    expect(auditLogs.some((l) => l.accion === 'LOGIN_DISPOSITIVO_NO_AUTORIZADO')).toBe(true);
    expect(auditLogs.some((l) => l.accion === 'LOGIN')).toBe(false);
  });
});
