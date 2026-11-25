import { BadRequestException, ConflictException } from '@nestjs/common';
import { UsersService, normalizarNombreClave } from './users.service';
import { Role } from '../../common/enums/role.enum';
import { UserStatus } from '../../common/enums/user-status.enum';

/**
 * I75 — Asociación usuario↔comercial con el nombre como llave.
 * El servicio se prueba con repositorios simulados (sin BD): lo importante
 * es la lógica de normalización, la fail-safe ante ambigüedad/ocupación y
 * la validación del comercial explícito.
 */
describe('UsersService — asociación comercial por nombre (I75)', () => {
  const ADMIN = { id: 'admin-1', username: 'admin' };

  let usersRepo: any;
  let comercialesRepo: any;
  let passwordPolicy: any;
  let audit: any;
  let service: UsersService;

  const COMERCIALES = [
    { id: 'com-1', nombre: 'Comercial Uno', activo: true },
    { id: 'com-2', nombre: 'COMERCIAL DOS', activo: true },
    { id: 'com-3', nombre: 'Repetido Hermanos', activo: true },
    { id: 'com-4', nombre: 'repetido   hermanos', activo: true }, // duplicado normalizado
    { id: 'com-5', nombre: 'Comercial Inactivo', activo: false },
  ];

  function dtoBase(extra: Record<string, unknown> = {}) {
    return {
      nombre: 'Comercial Uno',
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

  describe('normalizarNombreClave', () => {
    it('ignora mayúsculas, tildes y espacios repetidos', () => {
      expect(normalizarNombreClave('  JUAN   Pérez ')).toBe('juan perez');
      expect(normalizarNombreClave('juan perez')).toBe('juan perez');
      expect(normalizarNombreClave('José Ángel Ñúñez')).toBe('jose angel nunez');
    });
  });

  describe('create', () => {
    it('asocia automáticamente por nombre exacto (estado AUTO) y lo audita', async () => {
      const res: any = await service.create(dtoBase(), ADMIN);
      expect(res.comercialId).toBe('com-1');
      expect(res.asociacionComercial).toMatchObject({
        estado: 'AUTO',
        comercialId: 'com-1',
        comercialNombre: 'Comercial Uno',
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ motivo: expect.stringContaining('Comercial Uno') }),
      );
    });

    it('la llave ignora mayúsculas, tildes y espacios', async () => {
      const res: any = await service.create(
        dtoBase({ nombre: '  comercial   UNO ' }),
        ADMIN,
      );
      expect(res.asociacionComercial.estado).toBe('AUTO');
      expect(res.comercialId).toBe('com-1');
    });

    it('sin coincidencia queda sin comercial y avisa (SIN_COINCIDENCIA)', async () => {
      const res: any = await service.create(dtoBase({ nombre: 'Persona Sin Comercial' }), ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial.estado).toBe('SIN_COINCIDENCIA');
      expect(res.asociacionComercial.mensaje).toContain('Persona Sin Comercial');
    });

    it('no asocia contra comerciales inactivos', async () => {
      const res: any = await service.create(dtoBase({ nombre: 'Comercial Inactivo' }), ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial.estado).toBe('SIN_COINCIDENCIA');
    });

    it('con dos comerciales del mismo nombre no adivina (AMBIGUA)', async () => {
      const res: any = await service.create(dtoBase({ nombre: 'Repetido Hermanos' }), ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial.estado).toBe('AMBIGUA');
    });

    it('si el comercial ya tiene usuario activo no lo reasigna (YA_ASIGNADO)', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.comercialId === 'com-1') {
          return { id: 'otro', username: 'comercial.previo', estado: UserStatus.ACTIVO };
        }
        return null;
      });
      const res: any = await service.create(dtoBase(), ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial.estado).toBe('YA_ASIGNADO');
      expect(res.asociacionComercial.mensaje).toContain('comercial.previo');
    });

    it('comercialId explícito válido tiene prioridad (MANUAL)', async () => {
      const res: any = await service.create(
        dtoBase({ nombre: 'Nombre Que No Existe', comercialId: 'com-2' }),
        ADMIN,
      );
      expect(res.comercialId).toBe('com-2');
      expect(res.asociacionComercial.estado).toBe('MANUAL');
    });

    it('comercialId explícito inexistente → 400 (antes era un 500 por la FK)', async () => {
      await expect(
        service.create(dtoBase({ comercialId: 'no-existe' }), ADMIN),
      ).rejects.toThrow(BadRequestException);
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
      nombre: 'Comercial Dos',
      descripcion: '',
      username: 'comercial.dos',
      email: 'comercial.dos@sofia.local',
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

    it('al editar sin tocar el comercial, auto-asocia por el nombre vigente', async () => {
      const res: any = await service.update('usr-1', { descripcion: 'x' } as any, ADMIN);
      expect(res.comercialId).toBe('com-2'); // «COMERCIAL DOS» normalizado
      expect(res.asociacionComercial.estado).toBe('AUTO');
    });

    it('usa el nombre nuevo como llave cuando se edita el nombre', async () => {
      const res: any = await service.update('usr-1', { nombre: 'Comercial Uno' } as any, ADMIN);
      expect(res.comercialId).toBe('com-1');
    });

    it('comercialId null explícito = desasociar (no re-auto-asocia)', async () => {
      const res: any = await service.update('usr-1', { comercialId: null } as any, ADMIN);
      expect(res.comercialId).toBeNull();
      expect(res.asociacionComercial).toBeUndefined();
    });

    it('comercialId explícito en edición → MANUAL', async () => {
      const res: any = await service.update('usr-1', { comercialId: 'com-1' } as any, ADMIN);
      expect(res.comercialId).toBe('com-1');
      expect(res.asociacionComercial.estado).toBe('MANUAL');
    });

    it('cambio de rol a COMERCIAL sin comercial → intenta la llave por nombre', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') {
          return { ...existente, rol: Role.OPERADOR, comercialId: null };
        }
        return null;
      });
      const res: any = await service.update('usr-1', { rol: Role.COMERCIAL } as any, ADMIN);
      expect(res.comercialId).toBe('com-2');
      expect(res.asociacionComercial.estado).toBe('AUTO');
    });

    it('al cambiar a otro rol se limpia el comercial asociado', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente, comercialId: 'com-2' };
        return null;
      });
      const res: any = await service.update('usr-1', { rol: Role.GENERADOR } as any, ADMIN);
      expect(res.comercialId).toBeNull();
    });

    it('un usuario ya asociado no se reasigna a sí mismo al editarse', async () => {
      usersRepo.findOne.mockImplementation(async ({ where }: any) => {
        if (where?.id === 'usr-1') return { ...existente, comercialId: 'com-2' };
        if (where?.comercialId === 'com-2') return { ...existente, comercialId: 'com-2' };
        return null;
      });
      const res: any = await service.update('usr-1', { descripcion: 'y' } as any, ADMIN);
      expect(res.comercialId).toBe('com-2'); // conserva su comercial
      expect(res.asociacionComercial).toBeUndefined(); // no intentó auto
    });
  });
});
