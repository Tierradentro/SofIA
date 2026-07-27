import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InboundService } from './inbound.service';
import {
  ApproveInboundDto,
  CajaPrincipalDto,
  CancelInboundDto,
  CantidadRecibidaDto,
  CreateInboundDto,
  UpdateInboundDto,
} from './dto/inbound.dto';
import { InboundStatus } from './entities/inbound-receipt.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { BadRequestException } from '@nestjs/common';

/**
 * M07 (EP-06): ingreso de mercancía.
 * Generador: crea, corrige, aprueba, cancela.
 * Operador: inicia tarea, caja principal, cantidades, cierre de conteo.
 */
@Controller('inbound')
export class InboundController {
  constructor(private readonly inbound: InboundService) {}

  /** HU-022: crear actividad (factura OCR o registro manual). */
  @Post()
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  create(@Body() dto: CreateInboundDto, @CurrentUser() user: AuthenticatedUser) {
    return this.inbound.create(dto, user);
  }

  @Get()
  findAll(
    @Query('empresaId') empresaId?: string,
    @Query('estado') estado?: InboundStatus,
  ) {
    if (estado && !Object.values(InboundStatus).includes(estado)) {
      throw new BadRequestException('estado inválido');
    }
    return this.inbound.findAll(empresaId, estado);
  }

  @Get(':id')
  getDetalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.inbound.getDetalle(id);
  }

  /** Corrección (documento no legible / Pendiente_Corrección). */
  @Patch(':id')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInboundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inbound.update(id, dto, user);
  }

  /** Paso 3: el Operador toma la tarea. */
  @Post(':id/iniciar')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  iniciar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inbound.iniciar(id, user);
  }

  /** HU-023: código de caja principal / contenedor. */
  @Post(':id/caja')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  registrarCaja(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CajaPrincipalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inbound.registrarCaja(id, dto.codigoCaja, user);
  }

  /** HU-024/HU-027: cantidad recibida por producto. */
  @Put(':id/items/:itemId/cantidad')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  registrarCantidad(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: CantidadRecibidaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inbound.registrarCantidad(id, itemId, dto.cantidadRecibida, user);
  }

  /** Paso 4: cierre de conteo con comparación y alertas (HU-025). */
  @Post(':id/cerrar-conteo')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  cerrarConteo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.inbound.cerrarConteo(id, user);
  }

  /** HU-026: aprobación del Generador (observación si hay novedad). */
  @Post(':id/approve')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveInboundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inbound.approve(id, dto, user);
  }

  /** Generador puede cancelar en cualquier momento del flujo. */
  @Post(':id/cancel')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelInboundDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inbound.cancel(id, dto.motivo, user);
  }
}
