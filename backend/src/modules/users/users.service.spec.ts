import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';

/**
 * I77 — Asociación usuario↔comercial SIEMPRE manual (la decide el
 * administrador; el nombre del usuario no es llave) y exclusiva: un
 * comercial no admite dos usuarios comerciales activos.
 * El servicio se prueba con repositorios simulados (sin BD).
 */
describe('UsersService — asociación comercial manual (I77)', () => {
  const ADMIN = { id: 'admin-1', username: 'admin' };

  let usersRepo: any;
  let comercialesRepo: any;
  let passwordPolicy: any;
  let audit: any;
  let service: UsersService;

  const COMERCIALES = [
    { id: 'com-1', nombre: 'Comercial Uno', activo: true },
    { id: 'com-2', nombre: 'Comercial Dos', activo: true },
  ];

  function dtoBase(extra: Record<string, unknown> = {}) {
    return {
      nombre: 'Comercial Uno', // a propósito igual al comercial: NO es llave
      username: 'comercial.uno',
      email: 'comercial.uno@sofia.local',
      rol: Role.COMERCIAL,
      claveInicial: 'ClaveInicial1',
      ...extra,
    } as any;
  }

  beforeEach(() => {
    usersRepo = {
      findOne: jest.fn().mockResolvedValue(null), // sin duplicados / sin ocupante
      find: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ ...v, id: 'usr-1', fechaCreacion: new Date() })),
    };
    comercialesRepo = {
      findOne: jest.fn(async ({ where }: any) =>
        COMERCIALES.find((c) => c.id === where.id) ?? null,
      ),
      find: jest.fn(async ({ where }: any) =>
        COMERCIALES.filter((c) => c.activo === where.activo),
      ),
    };
    passwordPolicy = { validate: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new UsersService(usersRepo, comercialesRepo, passwordPolicy, audit);
  });

  describe('create', () => {
    it('sin comercialId queda sin asociar aunque el nombre coincida (ya no es llave)', async () => {
      const res: any = await service.create(dtoBase(), ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial).toMatchObject({
        estado: 'SIN_ASOCIAR',
        comercialId: null,
      });
      expect(res.asociacionComercial.mensaje).toContain('manualmente');
    });

    it('comercialId explícito válido asocia (MANUAL)', async () => {
      const res: any = await service.create(dtoBase({ comercialId: 'com-1' }), ADMIN);
      expect(res.comercialId).toBe('com-1');
      expect(res.asociacionComercial).toMatchObject({
        estado: 'MANUAL',
        comercialId: 'com-1',
        comercialNombre: 'Comercial Uno',
      });
    });

    it('comercialId inexistente → 400 (antes 500 por la FK)', async () => {
      await expect(
        service.create(dtoBase({ comercialId: 'no-existe' }), ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('comercial ya asignado a otro usuario activo → 409', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.comercialId === 'com-1') {
          return { id: 'otro', username: 'comercial.previo', estado: UserStatus.ACTIVO };
        }
        return null;
      });
      await expect(
        service.create(dtoBase({ comercialId: 'com-1' }), ADMIN),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.create(dtoBase({ comercialId: 'com-1' }), ADMIN),
      ).rejects.toThrow(/comercial\.previo/);
    });

    it('un comercial asignado a un usuario INACTIVO sí se puede reasignar', async () => {
      // El ocupante solo bloquea si está ACTIVO (estado del filtro)
      const res: any = await service.create(dtoBase({ comercialId: 'com-1' }), ADMIN);
      expect(res.comercialId).toBe('com-1');
      expect(usersRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ estado: UserStatus.ACTIVO }),
        }),
      );
    });

    it('roles distintos a COMERCIAL no reciben asociación', async () => {
      const res: any = await service.create(
        dtoBase({ rol: Role.OPERADOR, nombre: 'Operario' }),
        ADMIN,
      );
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial).toBeUndefined();
    });

    it('rol no COMERCIAL con comercialId → 400 (regla M06 intacta)', async () => {
      await expect(
        service.create(dtoBase({ rol: Role.GENERADOR, comercialId: 'com-1' }), ADMIN),
      ).rejects.toThrow(BadRequestException);
    });

    it('usuario o correo duplicado → 409 (regla existente intacta)', async () => {
      usersRepo.findOne.mockResolvedValueOnce({ id: 'dup' });
      await expect(service.create(dtoBase(), ADMIN)).rejects.toThrow(ConflictException);
    });
  });

  describe('update', () => {
    const existente = {
      id: 'usr-1',
      nombre: 'Vendedor Externo',
      descripcion: '',
      username: 'comercial.i77',
      email: 'comercial.i77@sofia.local',
      rol: Role.COMERCIAL,
      estado: UserStatus.ACTIVO,
      comercialId: null,
    };

    beforeEach(() => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente };
        return null;
      });
    });

    it('asigna el comercial indicado (MANUAL)', async () => {
      const res: any = await service.update('usr-1', { comercialId: 'com-2' } as any, ADMIN);
      expect(res.comercialId).toBe('com-2');
      expect(res.asociacionComercial.estado).toBe('MANUAL');
    });

    it('comercialId null explícito = desasociar', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente, comercialId: 'com-2' };
        return null;
      });
      const res: any = await service.update('usr-1', { comercialId: null } as any, ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial).toBeUndefined();
    });

    it('si el campo no viene, conserva la asociación actual', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente, comercialId: 'com-2' };
        return null;
      });
      const res: any = await service.update('usr-1', { descripcion: 'x' } as any, ADMIN);
      expect(res.comercialId).toBe('com-2');
      expect(res.asociacionComercial).toBeUndefined();
    });

    it('reasignar a un comercial ocupado por otro usuario → 409', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente };
        if (where?.comercialId === 'com-1') {
          return { id: 'otro', username: 'comercial.previo', estado: UserStatus.ACTIVO };
        }
        return null;
      });
      await expect(
        service.update('usr-1', { comercialId: 'com-1' } as any, ADMIN),
      ).rejects.toThrow(ConflictException);
    });

    it('el ocupante actual puede reafirmar su propio comercial (no se bloquea a sí mismo)', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente, comercialId: 'com-1' };
        if (where?.comercialId === 'com-1') {
          return { ...existente, comercialId: 'com-1' }; // él mismo
        }
        return null;
      });
      const res: any = await service.update('usr-1', { comercialId: 'com-1' } as any, ADMIN);
      expect(res.comercialId).toBe('com-1');
    });

    it('cambio de rol a COMERCIAL sin comercial → queda sin asociar (manual después)', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente, rol: Role.OPERADOR };
        return null;
      });
      const res: any = await service.update('usr-1', { rol: Role.COMERCIAL } as any, ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial).toBeUndefined();
    });

    it('al cambiar a otro rol se limpia el comercial asociado', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente, comercialId: 'com-2' };
        return null;
      });
      const res: any = await service.update('usr-1', { rol: Role.GENERADOR } as any, ADMIN);
      expect(res.comercialId).toBeNull();
    });
  });
});
