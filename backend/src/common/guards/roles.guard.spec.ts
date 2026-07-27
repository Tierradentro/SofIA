import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Role } from '../enums/role.enum';

function ctxConRol(rol: string | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user: rol ? { rol } : undefined }),
    }),
  } as any;
}

describe('RolesGuard — RBAC enforceado en backend (Spec §4)', () => {
  const reflector = new Reflector();
  const guard = new RolesGuard(reflector);

  it('permite cuando el endpoint no declara roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(guard.canActivate(ctxConRol(Role.OPERADOR))).toBe(true);
  });

  it('permite cuando el rol del usuario está autorizado', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.ADMINISTRADOR]);
    expect(guard.canActivate(ctxConRol(Role.ADMINISTRADOR))).toBe(true);
  });

  it('403 cuando el rol no está autorizado (prueba negativa)', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.ADMINISTRADOR]);
    expect(() => guard.canActivate(ctxConRol(Role.OPERADOR))).toThrow(
      ForbiddenException,
    );
  });

  it('rechaza cuando no hay usuario autenticado', () => {
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockReturnValue([Role.GENERADOR]);
    expect(guard.canActivate(ctxConRol(undefined))).toBe(false);
  });
});
