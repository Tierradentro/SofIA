import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { AuditService } from '../audit/audit.service';

const TABLA = 'Clientes'; // una de las 6 entidades auditables (regla transversal)

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateClientDto, user: { id: string; username: string }) {
    const client = await this.clients.save(this.clients.create(dto));
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: client.id,
      valorNuevo: client as any,
    });
    return client;
  }

  /** Listado con búsqueda por nombre/identificación (uso en pedidos, M08). */
  findAll(q?: string) {
    return this.clients.find({
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

  /**
   * Detalle de cliente. La lectura de datos sensibles de clientes se audita
   * (M15): se registra la lectura individual, no los listados paginados (R-03).
   */
  async findOne(id: string, user: { id: string; username: string }) {
    const client = await this.clients.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'LECTURA',
      tabla: TABLA,
      registroId: id,
    });
    return client;
  }

  /**
   * Resumen del cliente para el dashboard (M04): pedidos, despachos y
   * devoluciones PQRS. Los contadores se alimentan de los módulos que
   * llegan en I7/I8/I9; aquí queda la estructura del contrato.
   */
  async resumen(id: string, user: { id: string; username: string }) {
    const client = await this.findOne(id, user);
    return {
      cliente: client,
      pedidos: { total: 0 },
      despachos: { total: 0 },
      devolucionesPqrs: { total: 0 },
      nota: 'Los contadores operativos se completan con los módulos de Pedidos (I7), Despachos (I8) y PQRS (I9)',
    };
  }

  async update(id: string, dto: UpdateClientDto, user: { id: string; username: string }) {
    const client = await this.clients.findOne({ where: { id } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    const anterior = { ...client };
    Object.assign(client, dto);
    const saved = await this.clients.save(client);
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
