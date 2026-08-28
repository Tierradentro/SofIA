import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { WarehousesService } from './warehouses.service';
import { ConfigureWarehouseDto } from './dto/configure-warehouse.dto';
import { AssignLocationDto, MoveCajonDto } from './dto/warehouse-ops.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * HU-014/057/059 (EP-11 / M16): configuración y consulta del mapa 2D de
 * bodega. Configuración solo Administrador; asociación de productos
 * Generador; consulta Operador/Generador.
 */
@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  /** Mapa 2D completo (estructura + ocupación). Roles operativos. */
  @Get('map')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  getMapa() {
    return this.warehouses.getMapa();
  }

  /** Configurar la bodega (asistente) — Administrador. */
  @Post('configure')
  @Roles(Role.ADMINISTRADOR)
  configure(@Body() dto: ConfigureWarehouseDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.warehouses.configure(dto, admin);
  }

  /** Mover/redimensionar un cajón (pasillo o área) — Administrador. */
  @Patch(':tipo/:id/posicion')
  @Roles(Role.ADMINISTRADOR)
  mover(
    @Param('tipo') tipo: 'pasillo' | 'area',
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveCajonDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.warehouses.moverCajon(tipo, id, dto, admin);
  }

  /** Asociar producto a ubicación — Generador. */
  @Post('locations')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  assign(@Body() dto: AssignLocationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.warehouses.assignLocation(dto, user);
  }

  /** Ubicaciones de un producto — roles operativos. */
  @Get('products/:id/locations')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  locationsOfProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.warehouses.locationsOfProduct(id);
  }

  /** Buscar producto y resaltar su ubicación (ruta básica, HU-059). */
  @Get('locate')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  locate(@Query('q') q: string) {
    return this.warehouses.locateProduct(q);
  }
}
