import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Comercial } from './entities/comercial.entity';
import { CreateComercialDto, UpdateComercialDto } from './dto/comercial.dto';
import { AuditService } from '../audit/audit.service';

const TABLA = 'comerciales';

@Injectable()
export class ComercialesService {
  constructor(
    @InjectRepository(Comercial)
    private readonly comerciales: Repository<Comercial>,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateComercialDto, user: { id: string; username: string }) {
    const comercial = await this.comerciales.save(this.comerciales.create(dto));
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: comercial.id,
      valorNuevo: comercial as any,
    });
    return comercial;
  }

  findAll(q?: string) {
    return this.comerciales.find({
      where: q
        ? [
            { nombre: ILike(`%${q}%`), activo: true },
            { identificacion: ILike(`%${q}%`), activo: true },
          ]
        : { activo: true },
      order: { nombre: 'ASC' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const comercial = await this.comerciales.findOne({ where: { id } });
    if (!comercial) throw new NotFoundException('Comercial no encontrado');
    return comercial;
  }

  async update(id: string, dto: UpdateComercialDto, user: { id: string; username: string }) {
    const comercial = await this.findOne(id);
    const anterior = { ...comercial };
    Object.assign(comercial, dto);
    const saved = await this.comerciales.save(comercial);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'EDITAR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior as any,
      valorNuevo: saved as any,
    });
    return saved;
  }
}
