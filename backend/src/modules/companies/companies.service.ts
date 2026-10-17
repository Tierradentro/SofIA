import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';
import { SystemParam } from '../params/entities/system-param.entity';
import { woConfigPorDefecto, WO_PARAM_PREFIX } from '../exports/world-office';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { AuditService } from '../audit/audit.service';

const TABLA = 'companies';

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCompanyDto, admin: { id: string; username: string }) {
    const dup = await this.companies.findOne({
      where: [{ nombre: dto.nombre }, { siglas: dto.siglas }],
    });
    if (dup) throw new ConflictException('La empresa o sus siglas ya existen');
    const company = await this.companies.save(this.companies.create(dto));
    // I51: toda empresa nueva nace con su configuración de exportación a WO
    // (valores por defecto; el administrador los ajusta en Parámetros).
    await this.companies.manager.save(
      SystemParam,
      this.companies.manager.create(SystemParam, {
        clave: `${WO_PARAM_PREFIX}${company.siglas}`,
        valor: woConfigPorDefecto() as Record<string, any>,
        descripcion: `Exportación a World Office de ${company.nombre} (nombre en WO, tipo doc, bodega, forma de pago, IVA y consecutivo)`,
      }),
    );
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: company.id,
      valorNuevo: company as any,
    });
    return company;
  }

  /** Todas las empresas: todos los usuarios tienen acceso a las empresas creadas (M02). */
  findAll() {
    return this.companies.find({ where: { activo: true }, order: { nombre: 'ASC' } });
  }

  async findOne(id: string) {
    const company = await this.companies.findOne({ where: { id } });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto, admin: { id: string; username: string }) {
    const company = await this.findOne(id);
    if ((dto.nombre && dto.nombre !== company.nombre) || (dto.siglas && dto.siglas !== company.siglas)) {
      const dup = await this.companies.findOne({
        where: [{ nombre: dto.nombre || '' }, { siglas: dto.siglas || '' }],
      });
      if (dup && dup.id !== id) {
        throw new ConflictException('La empresa o sus siglas ya existen');
      }
    }
    const anterior = { ...company };
    Object.assign(company, dto);
    const saved = await this.companies.save(company);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'EDITAR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior as any,
      valorNuevo: saved as any,
    });
    return saved;
  }
}
