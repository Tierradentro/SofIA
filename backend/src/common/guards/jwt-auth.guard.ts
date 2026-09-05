import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { User } from '../../modules/users/entities/user.entity';
import { UserStatus } from '../enums/user-status.enum';
import { Role } from '../enums/role.enum';
import { ApiKey } from '../../modules/api-keys/entities/api-key.entity';
import { TokenBlacklistService } from '../../modules/auth/token-blacklist.service';
import { ParamsService } from '../../modules/params/params.service';
import {
  descripcionHorario,
  estaEnHorarioLogistica,
  HorarioLogistica,
} from '../../modules/params/horario-logistica';

/** Rutas permitidas cuando el usuario debe cambiar la clave (M02). */
const ALLOWED_WHEN_MUST_CHANGE = [
  '/api/v1/auth/change-password',
  '/api/v1/auth/me',
  '/api/v1/auth/logout',
];

/**
 * Guard global de autenticación JWT. Valida firma, blacklist (logout),
 * estado del usuario en BD (fresco, no solo el claim) y la puerta de
 * cambio obligatorio de clave en primer login / clave expirada (M02).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  /** Ventanas de rate limit por API key (60 s; EP-12). */
  private readonly rateBuckets = new Map<string, { count: number; resetAt: number }>();
  /** I36: caché corto del horario de logística (30 s) para no consultar la BD en cada petición. */
  private horarioCache: { at: number; valor: HorarioLogistica } | null = null;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(ApiKey) private readonly apiKeys: Repository<ApiKey>,
    private readonly blacklist: TokenBlacklistService,
    private readonly params: ParamsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();

    // EP-12: autenticación por API key (header X-API-Key) para sistemas
    // externos; solo usuarios con rol API y key activa.
    const apiKeyHeader: string = request.headers['x-api-key'] || '';
    if (apiKeyHeader) {
      return this.authenticateApiKey(request, apiKeyHeader.trim());
    }

    const header: string = request.headers['authorization'] || '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    if (await this.blacklist.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Sesión finalizada');
    }

    const user = await this.users.findOne({ where: { id: payload.sub } });
    if (!user || user.estado !== UserStatus.ACTIVO) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    request.user = {
      id: user.id,
      username: user.username,
      nombre: user.nombre,
      rol: user.rol,
      comercialId: user.comercialId,
      jti: payload.jti,
      exp: payload.exp,
    };

    // I36: control de acceso por horario de logística. No aplica al
    // Administrador ni a los sistemas externos (rol API con X-API-Key, que
    // no pasan por este punto del guard).
    if (user.rol !== Role.ADMINISTRADOR) {
      const horario = await this.getHorarioCache();
      if (!estaEnHorarioLogistica(horario)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'FUERA_DE_HORARIO',
          message:
            'El acceso a la aplicación está restringido al horario de logística ' +
            `configurado (${descripcionHorario(horario)}). Consulte al administrador.`,
        });
      }
    }

    // Puerta de cambio obligatorio de clave (primer login / expiración 60 días)
    if (user.debeCambiarClave) {
      const path: string = request.route?.path || request.url || '';
      if (!ALLOWED_WHEN_MUST_CHANGE.some((p) => path.endsWith(p) || path === p)) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Debe cambiar su contraseña antes de continuar',
        });
      }
    }

    return true;
  }

  /** I36: horario de logística con caché de 30 s (se lee en cada petición
   * autenticada). HORARIO_CACHE_MS permite ajustar el TTL (0 en pruebas). */
  private async getHorarioCache(): Promise<HorarioLogistica> {
    const ttl = Number(process.env.HORARIO_CACHE_MS ?? 30_000);
    const ahora = Date.now();
    if (this.horarioCache && ahora - this.horarioCache.at < ttl) {
      return this.horarioCache.valor;
    }
    const valor = await this.params.getHorarioLogistica();
    this.horarioCache = { at: ahora, valor };
    return valor;
  }

  /**
   * EP-12: autenticación de sistemas externos con API key (M17).
   * La key se compara por hash SHA-256 (nunca en plano), debe estar activa
   * y asociada a un usuario ACTIVO con rol API. Aplica rate limit por key
   * (parámetro del sistema requests_per_minute, 20 por defecto; la variable
   * EXTERNAL_API_RATE_LIMIT solo lo anula de forma explícita) y registra
   * el último uso.
   */
  private async authenticateApiKey(request: any, rawKey: string): Promise<boolean> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const key = await this.apiKeys.findOne({ where: { keyHash } });
    if (!key || !key.activo) {
      throw new UnauthorizedException('API key inválida');
    }
    const user = await this.users.findOne({ where: { id: key.userId } });
    if (!user || user.estado !== UserStatus.ACTIVO || user.rol !== Role.API) {
      throw new UnauthorizedException('API key inválida');
    }
    // H-3: el límite es parametrizable (spec §7: 20 req/min por defecto);
    // la variable de entorno solo actúa como anulación explícita
    await this.checkRateLimit(key.id);

    key.lastUsedAt = new Date();
    await this.apiKeys.save(key);

    request.user = {
      id: user.id,
      username: user.username,
      nombre: user.nombre,
      rol: user.rol,
      comercialId: user.comercialId,
      viaApiKey: true,
      apiKeyId: key.id,
    };
    return true;
  }

  /**
   * Rate limit por API key: ventana deslizante de 60 segundos. El límite se
   * lee del parámetro del sistema (spec §7: requests_per_minute, 20 por
   * defecto); EXTERNAL_API_RATE_LIMIT solo lo anula de forma explícita.
   */
  private async checkRateLimit(keyId: string): Promise<void> {
    const limit = process.env.EXTERNAL_API_RATE_LIMIT
      ? Number(process.env.EXTERNAL_API_RATE_LIMIT)
      : await this.params.getApiRateLimit();
    const now = Date.now();
    const bucket = this.rateBuckets.get(keyId);
    if (!bucket || bucket.resetAt <= now) {
      this.rateBuckets.set(keyId, { count: 1, resetAt: now + 60_000 });
      return;
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw new HttpException(
        {
          statusCode: 429,
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Límite de ${limit} peticiones por minuto excedido para esta API key`,
        },
        429,
      );
    }
  }
}
