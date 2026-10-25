import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { DevicesService } from './devices.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * I57: control de dispositivos. La administración (listar, aprobar,
 * rechazar, revocar) es exclusiva del Administrador; el sondeo de estado
 * es público porque lo usa la pantalla de espera antes de tener sesión
 * (solo expone el estado, sin datos del dispositivo).
 */
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  /** Sondeo público: estado del navegador que pregunta (pantalla de espera). */
  @Public()
  @Get('estado')
  estado(@Headers('x-device-id') deviceId?: string) {
    if (!deviceId) throw new UnauthorizedException('Dispositivo no identificado');
    return this.devices.estadoDe(deviceId);
  }

  @Get()
  @Roles(Role.ADMINISTRADOR)
  findAll() {
    return this.devices.findAll();
  }

  @Post(':id/aprobar')
  @HttpCode(200)
  @Roles(Role.ADMINISTRADOR)
  aprobar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devices.aprobar(id, user);
  }

  @Post(':id/rechazar')
  @HttpCode(200)
  @Roles(Role.ADMINISTRADOR)
  rechazar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devices.rechazar(id, user);
  }

  @Post(':id/revocar')
  @HttpCode(200)
  @Roles(Role.ADMINISTRADOR)
  revocar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devices.revocar(id, user);
  }
}
