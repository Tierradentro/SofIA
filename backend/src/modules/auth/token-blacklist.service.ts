import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Blacklist de tokens JWT invalidados al cerrar sesión (HU-002).
 * Usa Redis cuando REDIS_URL está disponible; en su defecto, un mapa
 * en memoria (entorno de pruebas/desarrollo local).
 */
@Injectable()
export class TokenBlacklistService implements OnModuleDestroy {
  private redis: Redis | null = null;
  private memory = new Map<string, number>(); // jti -> exp (epoch segundos)

  constructor() {
    const url = process.env.REDIS_URL;
    if (url && process.env.NODE_ENV !== 'test') {
      try {
        this.redis = new Redis(url, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: () => null,
        });
        this.redis.connect().catch(() => {
          this.redis = null;
        });
        this.redis.on('error', () => {
          this.redis = null;
        });
      } catch {
        this.redis = null;
      }
    }
  }

  async revoke(jti: string, expEpochSeconds: number): Promise<void> {
    const ttl = Math.max(1, expEpochSeconds - Math.floor(Date.now() / 1000));
    if (this.redis) {
      try {
        await this.redis.set(`bl:${jti}`, '1', 'EX', ttl);
        return;
      } catch {
        /* cae a memoria */
      }
    }
    this.memory.set(jti, expEpochSeconds);
  }

  async isRevoked(jti: string): Promise<boolean> {
    if (!jti) return false;
    if (this.redis) {
      try {
        return (await this.redis.exists(`bl:${jti}`)) === 1;
      } catch {
        /* cae a memoria */
      }
    }
    const exp = this.memory.get(jti);
    if (!exp) return false;
    if (exp * 1000 < Date.now()) {
      this.memory.delete(jti);
      return false;
    }
    return true;
  }

  async onModuleDestroy() {
    if (this.redis) await this.redis.quit().catch(() => undefined);
  }
}
