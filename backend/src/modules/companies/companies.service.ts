import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';
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
