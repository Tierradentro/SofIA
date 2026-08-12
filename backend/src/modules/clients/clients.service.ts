import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { Client } from './entities/client.entity';
import { ClientAddress } from './entities/client-address.entity';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { AuditService } from '../audit/audit.service';

const TABLA = 'Clientes'; // una de las 6 entidades auditables (regla transversal)

/** QA Func. 4.1: máximo de direcciones de despacho por cliente. */
export const MAX_DIRECCIONES_CLIENTE = 10;

@Injectable()
export class ClientsService {
  constructor(
    @InjectRepository(Client) private readonly clients: Repository<Client>,
    @InjectRepository(ClientAddress)
    private readonly addresses: Repository<ClientAddress>,
    private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateClientDto, user: { id: string; username: string }) {
    const client = await this.clients.save(this.clients.create(dto));
    // QA Func. 4.1: la dirección del formulario queda como dirección principal
    if (dto.direccion?.trim()) {
      await this.addresses.save(
        this.addresses.create({
          clientId: client.id,
          direccion: dto.direccion.trim(),
          ciudad: dto.ciudad?.trim() || null,
          esPrincipal: true,
        }),
      );
    }
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

  /** QA Func. 4.1: direcciones activas del cliente (principal primero). */
  async listAddresses(clientId: string) {
    const client = await this.clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    return this.addresses.find({
      where: { clientId, activo: true },
      order: { esPrincipal: 'DESC', createdAt: 'ASC' },
    });
  }

  /** QA Func. 4.1: agregar dirección (máx. 10; la primera queda principal). */
  async addAddress(
    clientId: string,
    dto: CreateAddressDto,
    user: { id: string; username: string },
  ) {
    const client = await this.clients.findOne({ where: { id: clientId } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    const actuales = await this.addresses.count({ where: { clientId, activo: true } });
    if (actuales >= MAX_DIRECCIONES_CLIENTE) {
      throw new BadRequestException(
        `El cliente ya tiene el máximo de ${MAX_DIRECCIONES_CLIENTE} direcciones`,
      );
    }
    const esPrincipal = actuales === 0 || !!dto.esPrincipal;
    if (esPrincipal && actuales > 0) {
      await this.addresses.update({ clientId, esPrincipal: true }, { esPrincipal: false });
    }
    const direccion = await this.addresses.save(
      this.addresses.create({
        clientId,
        direccion: dto.direccion.trim(),
        ciudad: dto.ciudad?.trim() || null,
        esPrincipal,
      }),
    );
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'AGREGAR_DIRECCION',
      tabla: TABLA,
      registroId: clientId,
      valorNuevo: direccion as any,
    });
    return direccion;
  }

  /** QA Func. 4.1: editar dirección o marcarla como principal. */
  async updateAddress(
    clientId: string,
    addressId: string,
    dto: UpdateAddressDto,
    user: { id: string; username: string },
  ) {
    const direccion = await this.addresses.findOne({
      where: { id: addressId, clientId, activo: true },
    });
    if (!direccion) throw new NotFoundException('Dirección no encontrada');
    const anterior = { ...direccion };
    if (dto.esPrincipal && !direccion.esPrincipal) {
      await this.addresses.update({ clientId, esPrincipal: true }, { esPrincipal: false });
    }
    if (dto.direccion !== undefined) direccion.direccion = dto.direccion.trim();
    if (dto.ciudad !== undefined) direccion.ciudad = dto.ciudad?.trim() || null;
    if (dto.esPrincipal !== undefined) direccion.esPrincipal = dto.esPrincipal;
    const saved = await this.addresses.save(direccion);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'EDITAR_DIRECCION',
      tabla: TABLA,
      registroId: clientId,
      valorAnterior: anterior as any,
      valorNuevo: saved as any,
    });
    return saved;
  }

  /** QA Func. 4.1: eliminar (desactivar) una dirección no principal. */
  async removeAddress(
    clientId: string,
    addressId: string,
    user: { id: string; username: string },
  ) {
    const direccion = await this.addresses.findOne({
      where: { id: addressId, clientId, activo: true },
    });
    if (!direccion) throw new NotFoundException('Dirección no encontrada');
    if (direccion.esPrincipal) {
      throw new BadRequestException(
        'No se puede eliminar la dirección principal: marque otra como principal primero',
      );
    }
    direccion.activo = false;
    await this.addresses.save(direccion);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'ELIMINAR_DIRECCION',
      tabla: TABLA,
      registroId: clientId,
      valorAnterior: {
        direccion: direccion.direccion,
        ciudad: direccion.ciudad,
      },
    });
    return { eliminada: true };
  }
}
