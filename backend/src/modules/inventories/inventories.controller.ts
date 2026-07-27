import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import {
  CancelStockCountDto,
  CountItemDto,
  CreateStockCountDto,
  DocumentarDiferenciasDto,
} from './dto/inventory.dto';
import { StockCountStatus } from './entities/stock-count.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * M12 (EP-09): inventarios por empresa.
 * Creación, documentación de diferencias, aprobación y cancelación: Generador.
 * Conteo físico: Operador.
 */
@Controller('inventories')
export class InventoriesController {
  constructor(private readonly inventories: InventoriesService) {}

  /** HU-048: crear jornada por empresa con snapshot (Generador). */
  @Post()
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  create(@Body() dto: CreateStockCountDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inventories.create(dto, user);
  }

  /** HU-049: registro de conteo físico con ubicación (Operador). */
  @Post(':id/conteo')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  registrarConteo(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CountItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventories.registrarConteo(id, dto, user);
  }

  /** Operador finaliza el conteo → PENDIENTE_APROBACION. */
  @Post(':id/finalizar-conteo')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  finalizarConteo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventories.finalizarConteo(id, user);
  }

  /** HU-051: documentar diferencias antes de aprobar (Generador). */
  @Post(':id/diferencias')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  documentar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DocumentarDiferenciasDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventories.documentarDiferencias(id, dto, user);
  }

  /** HU-051: aprobar → ajustes AJUSTE_INVENTARIO (Generador). */
  @Post(':id/aprobar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  aprobar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inventories.aprobar(id, user);
  }

  /** HU-052: cancelar con motivo (existencias sin cambio). */
  @Post(':id/cancelar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelStockCountDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventories.cancel(id, dto, user);
  }

  @Get()
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  list(@Query('empresaId') empresaId?: string, @Query('estado') estado?: StockCountStatus) {
    return this.inventories.list({ empresaId, estado });
  }

  /** Detalle con comparación HU-050 (snapshot, conteo, diferencia, valor). */
  @Get(':id')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventories.get(id);
  }
}
