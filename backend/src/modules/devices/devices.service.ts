import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device, DeviceEstado } from './entities/device.entity';
import { AuditService } from '../audit/audit.service';
import { Role } from '../../common/enums/role.enum';

/** Características del navegador reportadas por el frontend en el login. */
export interface InfoDispositivo {
  deviceId: string;
  nombre?: string;
  userAgent?: string;
  idioma?: string;
  plataforma?: string;
  resolucion?: string;
}

/** Usuario autenticado mínimo para registrar acciones. */
export interface UsuarioAccion {
  id: string;
  nombre: string;
  username: string;
  rol: string;
}

/**
 * I57: control de dispositivos (navegadores autorizados). La autorización
 * es por dispositivo, no por usuario: un navegador aprobado sirve para
 * cualquier usuario. El primer login del Administrador desde un navegador
 * lo aprueba automáticamente; para los demás roles el navegador queda
 * PENDIENTE hasta que un Administrador lo apruebe (o lo rechace). Una
 * revocación bloquea el navegador aunque haya sesiones vigentes: el guard
 * valida el estado del dispositivo en cada petición.
 */
@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registra (o actualiza) el dispositivo en un login exitoso. Si el usuario
   * es Administrador y el dispositivo está PENDIENTE (nuevo), lo aprueba en
   * el acto — es la puerta de entrada que evita el bloqueo total del sistema.
   * Un RECHAZADO/REVOCADO no se reactiva solo: exige decisión explícita.
   */
  async registrarEnLogin(
    info: InfoDispositivo,
    user: UsuarioAccion,
    ip?: string,
  ): Promise<Device> {
    let device = await this.devices.findOne({ where: { deviceId: info.deviceId } });
    const ahora = new Date();
    if (!device) {
      device = this.devices.create({
        deviceId: info.deviceId,
        nombre: info.nombre || 'Navegador desconocido',
        userAgent: info.userAgent || '',
        idioma: info.idioma ?? null,
        plataforma: info.plataforma ?? null,
        resolucion: info.resolucion ?? null,
        ip: ip ?? null,
        estado: DeviceEstado.PENDIENTE,
        registradoPorId: user.id,
        registradoPorNombre: user.nombre || user.username,
        ultimoUsoAt: ahora,
      });
    } else {
      // Actualizar las características: el navegador se actualiza, cambia
      // de red, etc. El nombre se conserva si el cliente no lo reenvía.
      device.nombre = info.nombre || device.nombre;
      device.userAgent = info.userAgent || device.userAgent;
      device.idioma = info.idioma ?? device.idioma;
      device.plataforma = info.plataforma ?? device.plataforma;
      device.resolucion = info.resolucion ?? device.resolucion;
      device.ip = ip ?? device.ip;
      device.ultimoUsoAt = ahora;
    }
    if (user.rol === Role.ADMINISTRADOR && device.estado === DeviceEstado.PENDIENTE) {
      device.estado = DeviceEstado.APROBADO;
      device.aprobadoAt = ahora;
      device.aprobadoPorId = user.id;
      device.aprobadoPorNombre = `${user.nombre || user.username} (automático)`;
    }
    return this.devices.save(device);
  }

  /** Estado actual de un dispositivo (sondeo desde la pantalla de espera). */
  async estadoDe(deviceId: string): Promise<{ estado: DeviceEstado | 'DESCONOCIDO' }> {
    const device = await this.devices.findOne({ where: { deviceId } });
    return { estado: device?.estado ?? 'DESCONOCIDO' };
  }

  /** true si el dispositivo existe y está APROBADO (lo usa el guard global). */
  async estaAprobado(deviceId: string): Promise<boolean> {
    const n = await this.devices.count({
      where: { deviceId, estado: DeviceEstado.APROBADO },
    });
    return n > 0;
  }

  findAll() {
    return this.devices.find({ order: { createdAt: 'DESC' } });
  }

  async aprobar(id: string, admin: UsuarioAccion) {
    return this.cambiarEstado(id, admin, DeviceEstado.APROBADO, 'DISPOSITIVO_APROBADO');
  }

  async rechazar(id: string, admin: UsuarioAccion) {
    return this.cambiarEstado(id, admin, DeviceEstado.RECHAZADO, 'DISPOSITIVO_RECHAZADO');
  }

  async revocar(id: string, admin: UsuarioAccion) {
    return this.cambiarEstado(id, admin, DeviceEstado.REVOCADO, 'DISPOSITIVO_REVOCADO');
  }

  private async cambiarEstado(
    id: string,
    admin: UsuarioAccion,
    destino: DeviceEstado,
    accionAudit: string,
  ) {
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException('Dispositivo no encontrado');
    if (destino === DeviceEstado.REVOCADO && device.estado !== DeviceEstado.APROBADO) {
      throw new BadRequestException('Solo se puede revocar un dispositivo aprobado');
    }
    if (destino === DeviceEstado.RECHAZADO && device.estado === DeviceEstado.APROBADO) {
      throw new BadRequestException('Un dispositivo aprobado se revoca, no se rechaza');
    }
    const anterior = device.estado;
    const ahora = new Date();
    device.estado = destino;
    if (destino === DeviceEstado.APROBADO) {
      device.aprobadoAt = ahora;
      device.aprobadoPorId = admin.id;
      device.aprobadoPorNombre = admin.nombre || admin.username;
    } else if (destino === DeviceEstado.RECHAZADO) {
      device.rechazadoAt = ahora;
      device.rechazadoPorId = admin.id;
      device.rechazadoPorNombre = admin.nombre || admin.username;
    } else {
      device.revocadoAt = ahora;
      device.revocadoPorId = admin.id;
      device.revocadoPorNombre = admin.nombre || admin.username;
    }
    const guardado = await this.devices.save(device);
    await this.audit.log({
      usuarioId: admin.id,
      usuarioUsername: admin.username,
      accion: accionAudit,
      tabla: 'devices',
      registroId: device.id,
      valorAnterior: { estado: anterior },
      valorNuevo: { estado: destino },
    });
    return guardado;
  }
}
