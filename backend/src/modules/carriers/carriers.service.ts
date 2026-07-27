import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Carrier } from './entities/carrier.entity';
import { CreateCarrierDto } from './dto/create-carrier.dto';
import { UpdateCarrierDto } from './dto/update-carrier.dto';
import { AuditService } from '../audit/audit.service';

const TABLA = 'carriers';

@Injectable()
export class CarriersService {
  constructor(
    @InjectRepository(Carrier) private readonly carriers: Repository<Carrier>,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateCarrierDto, admin: { id: string; username: string }) {
    const dup = await this.carriers.findOne({ where: { nombre: dto.nombre } });
    if (dup) throw new ConflictException('La transportadora ya existe');
    const carrier = await this.carriers.save(this.carriers.create(dto));
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: carrier.id,
      valorNuevo: carrier as any,
    });
    return carrier;
  }

  /** Listado operativo: solo activas (para selección en despachos, M09). */
  findActivas() {
    return this.carriers.find({ where: { activo: true }, order: { nombre: 'ASC' } });
  }

  findAll() {
    return this.carriers.find({ order: { nombre: 'ASC' } });
  }

  async findOne(id: string) {
    const carrier = await this.carriers.findOne({ where: { id } });
    if (!carrier) throw new NotFoundException('Transportadora no encontrada');
    return carrier;
  }

  async update(id: string, dto: UpdateCarrierDto, admin: { id: string; username: string }) {
    const carrier = await this.findOne(id);
    if (dto.nombre && dto.nombre !== carrier.nombre) {
      const dup = await this.carriers.findOne({ where: { nombre: dto.nombre } });
      if (dup) throw new ConflictException('La transportadora ya existe');
    }
    const anterior = { ...carrier };
    Object.assign(carrier, dto);
    const saved = await this.carriers.save(carrier);
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
