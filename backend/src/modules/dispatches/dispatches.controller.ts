import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { DispatchesService } from './dispatches.service';
import {
  ApproveParcialDto,
  AssociateOrdersDto,
  CancelDispatchDto,
  CreateDispatchDto,
  ReturnDispatchDto,
  ScanBoxDto,
  TransportDto,
} from './dto/dispatch.dto';
import { DispatchStatus } from './entities/dispatch.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * M09 + M10 (EP-08): despachos y cajas.
 * Gestión del despacho: Generador. Packing (cajas/escaneo/cierre): Operador.
 * Aprobación de parcial, transporte y cancelación: Generador.
 */
@Controller('dispatches')
export class DispatchesController {
  constructor(private readonly dispatches: DispatchesService) {}

  /** HU-033: crear despacho con el primer pedido APROBADO del cliente. */
  @Post()
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  create(@Body() dto: CreateDispatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatches.create(dto, user);
  }

  /** HU-034: asociar más pedidos APROBADOS del mismo cliente. */
  @Post(':id/orders')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  associate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssociateOrdersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.associateOrders(id, dto, user);
  }

  /** Retirar un pedido (ciclo de corrección). */
  @Delete(':id/orders/:orderId')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  removeOrder(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.removeOrder(id, orderId, user);
  }

  /** M09 paso 2: aprobar despacho (CREADO/PENDIENTE_CORRECCION → ABIERTO). */
  @Post(':id/aprobar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  aprobar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatches.aprobar(id, user);
  }

  /** Operador devuelve el despacho al Generador (PENDIENTE_CORRECCION). */
  @Post(':id/devolver')
  @Roles(Role.OPERADOR)
  devolver(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReturnDispatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.devolver(id, dto, user);
  }

  /** HU-035/037: crear caja (CJA-###### global). */
  @Post(':id/boxes')
  @Roles(Role.OPERADOR)
  createBox(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatches.createBox(id, user);
  }

  /** HU-036: escaneo a caja (solo conteo; el descuento ocurre al cerrar). */
  @Post(':id/boxes/:boxId/scan')
  @Roles(Role.OPERADOR)
  scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('boxId', ParseUUIDPipe) boxId: string,
    @Body() dto: ScanBoxDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.scanToBox(id, boxId, dto, user);
  }

  /** HU-037: cerrar caja (descuento transaccional de Cantidad y bloqueada). */
  @Post(':id/boxes/:boxId/cerrar')
  @Roles(Role.OPERADOR)
  closeBox(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('boxId', ParseUUIDPipe) boxId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.closeBox(id, boxId, user);
  }

  /** HU-038: etiqueta con QR (solo box_id) — impresión y reimpresión. */
  @Get(':id/boxes/:boxId/etiqueta')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  etiqueta(@Param('id', ParseUUIDPipe) id: string, @Param('boxId', ParseUUIDPipe) boxId: string) {
    return this.dispatches.etiqueta(id, boxId);
  }

  /** M09 paso 4: finalizar empaque (completo o PARCIAL). */
  @Post(':id/finalizar-empaque')
  @Roles(Role.OPERADOR)
  finalizarEmpaque(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatches.finalizarEmpaque(id, user);
  }

  /** HU-041: aprobación del despacho parcial con motivo (Generador). */
  @Post(':id/aprobar-parcial')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  aprobarParcial(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveParcialDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.aprobarParcial(id, dto, user);
  }

  /**
   * HU-039/040: registro de transporte externa/interna → DESPACHADO.
   * I29: el Operador también puede registrar la salida — es quien termina el
   * empaque y tiene la caja física frente a la transportadora.
   */
  @Post(':id/transporte')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.ADMINISTRADOR)
  transporte(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.registerTransport(id, dto, user);
  }

  /** D-06/HU-042: despacho adicional para completar un parcial. */
  @Post(':id/completar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  completar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatches.completarParcial(id, user);
  }

  @Post(':id/cancelar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelDispatchDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.cancel(id, dto, user);
  }

  /** QA Func. 4.1: ajustar la dirección de entrega del despacho. */
  @Patch(':id/direccion')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  updateDireccion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('direccion') direccion: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatches.updateDireccion(id, direccion, user);
  }

  /** HU-054: consulta con filtros por cliente, empresa, fecha, documento, caja y guía. */
  @Get()
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estado') estado?: DispatchStatus,
    @Query('clienteId') clienteId?: string,
    @Query('empresaId') empresaId?: string,
    @Query('fechaDesde') fechaDesde?: string,
    @Query('fechaHasta') fechaHasta?: string,
    @Query('documento') documento?: string,
    @Query('boxId') boxId?: string,
    @Query('guia') guia?: string,
  ) {
    // Tablero del comercial (M02): solo despachos con pedidos de su comercial
    const comercialId = user.rol === Role.COMERCIAL ? user.comercialId : undefined;
    return this.dispatches.list({
      estado, clienteId, empresaId, fechaDesde, fechaHasta, documento, boxId, guia, comercialId,
    });
  }

  @Get(':id')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.dispatches.get(id, user);
  }
}

/** M10: consulta de caja por box_id (contenido del QR). */
@Controller('boxes')
export class BoxesController {
  constructor(private readonly dispatches: DispatchesService) {}

  @Get(':boxId')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  consulta(@Param('boxId') boxId: string) {
    return this.dispatches.consultaCaja(boxId);
  }
}
