import { BadRequestException } from '@nestjs/common';
import { ApiKeysService, hashApiKey } from './api-keys.service';
import { Role } from '../../common/enums/role.enum';

describe('ApiKeysService (M17)', () => {
  let service: ApiKeysService;
  let keysRepo: any;
  let usersRepo: any;
  let auditLogs: any[];

  beforeEach(() => {
    auditLogs = [];
    keysRepo = {
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      create: (x: any) => x,
      save: jest.fn(async (x) => ({ id: 'k1', createdAt: new Date(), lastUsedAt: null, ...x })),
      remove: jest.fn(),
    };
    usersRepo = { findOne: jest.fn() };
    const audit = { log: async (e: any) => auditLogs.push(e) } as any;
    service = new ApiKeysService(keysRepo, usersRepo, audit);
  });

  it('crea key: retorna la clave en claro una sola vez y guarda solo hash+prefijo', async () => {
    usersRepo.findOne.mockResolvedValue({ id: 'u1', rol: Role.API });
    const res = await service.create(
      { userId: 'u1', nombre: 'OpenClaw' },
      { id: 'a1', username: 'Admin' },
    );
    expect(res.clave).toMatch(/^sk_[0-9a-f]{48}$/);
    expect(res.key).not.toContain(res.clave);
    expect(res.key).toContain('•');
    const saved = keysRepo.save.mock.calls[0][0];
    expect(saved.keyHash).toBe(hashApiKey(res.clave));
    expect(saved.keyHash).not.toContain(res.clave);
    expect(saved.keyPrefix).toBe(res.clave.slice(0, 10));
  });

  it('rechaza asociar la key a un usuario que no tiene rol API (M14)', async () => {
    usersRepo.findOne.mockResolvedValue({ id: 'u1', rol: Role.OPERADOR });
    await expect(
      service.create({ userId: 'u1', nombre: 'X' }, { id: 'a1', username: 'Admin' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolve encuentra la key por su hash y marca lastUsedAt', async () => {
    const key = { id: 'k1', keyHash: hashApiKey('sk_test'), activo: true, lastUsedAt: null };
    keysRepo.findOne.mockResolvedValue(key);
    const res = await service.resolve('sk_test');
    expect(res).toBe(key);
    expect(key.lastUsedAt).toBeInstanceOf(Date);
  });
});
