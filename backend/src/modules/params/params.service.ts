import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemParam, PARAM_KEYS } from './entities/system-param.entity';

export interface PasswordPolicy {
  min_length: number;
  require_uppercase: boolean;
  require_lowercase: boolean;
  require_number: boolean;
  expiration_days: number;
  max_failed_attempts: number;
}

const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  min_length: 6,
  require_uppercase: true,
  require_lowercase: true,
  require_number: true,
  expiration_days: 60,
  max_failed_attempts: 5,
};

@Injectable()
export class ParamsService {
  constructor(
    @InjectRepository(SystemParam)
    private readonly repo: Repository<SystemParam>,
  ) {}

  async getValor<T = any>(clave: string): Promise<T | null> {
    const param = await this.repo.findOne({ where: { clave } });
    return param ? (param.valor as T) : null;
  }

  async getPasswordPolicy(): Promise<PasswordPolicy> {
    const valor = await this.getValor<Partial<PasswordPolicy>>(
      PARAM_KEYS.PASSWORD_POLICY,
    );
    return { ...DEFAULT_PASSWORD_POLICY, ...(valor || {}) };
  }

  async getApiRateLimit(): Promise<number> {
    const valor = await this.getValor<{ requests_per_minute: number }>(
      PARAM_KEYS.API_RATE_LIMIT,
    );
    return valor?.requests_per_minute ?? 20;
  }

  /** Listado para la pantalla de administración (M14). */
  findAll() {
    return this.repo.find({ order: { clave: 'ASC' } });
  }

  /**
   * Actualiza un parámetro con validación de esquema por clave y auditoría.
   * Solo claves conocidas; valores con tipos y rangos coherentes.
   */
  async update(
    clave: string,
    valor: Record<string, any>,
    motivo: string,
    admin: { id: string; username: string },
    audit: { log: (e: any) => Promise<any> },
  ) {
    const param = await this.repo.findOne({ where: { clave } });
    if (!param) {
      throw new NotFoundException(`Parámetro '${clave}' no existe`);
    }
    this.validateValue(clave, valor);
    const anterior = param.valor;
    param.valor = valor;
    const saved = await this.repo.save(param);
    await audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CONFIGURAR_PARAMETRO',
      tabla: 'system_params',
      registroId: clave,
      valorAnterior: anterior,
      valorNuevo: saved.valor,
      motivo,
    });
    return saved;
  }

  private validateValue(clave: string, valor: Record<string, any>) {
    const bad = (msg: string) => {
      throw new BadRequestException(`Valor inválido para ${clave}: ${msg}`);
    };
    if (clave === PARAM_KEYS.PASSWORD_POLICY) {
      const { min_length, expiration_days, max_failed_attempts } = valor as any;
      if (!Number.isInteger(min_length) || min_length < 6 || min_length > 64)
        bad('min_length debe ser entero entre 6 y 64');
      if (!Number.isInteger(expiration_days) || expiration_days < 1)
        bad('expiration_days debe ser entero ≥ 1');
      if (!Number.isInteger(max_failed_attempts) || max_failed_attempts < 1)
        bad('max_failed_attempts debe ser entero ≥ 1');
    } else if (clave === PARAM_KEYS.API_RATE_LIMIT) {
      const { requests_per_minute } = valor as any;
      if (!Number.isInteger(requests_per_minute) || requests_per_minute < 1)
        bad('requests_per_minute debe ser entero ≥ 1');
    } else if (clave === PARAM_KEYS.OCR_ACTIVE_ENGINE) {
      const { engine } = valor as any;
      if (engine !== 'OCR_LOCAL' && engine !== 'OCR_LLM')
        bad("engine debe ser 'OCR_LOCAL' u 'OCR_LLM'");
    }
    // Otras claves: JSON libre (declarativas por diseño)
  }
}
