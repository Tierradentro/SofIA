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
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';
import { CreateAddressDto, UpdateAddressDto } from './dto/address.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * M04 Clientes (catálogo global). Consulta: todos los roles autenticados
 * (necesaria para crear pedidos). Crear/editar: Generador y Administrador
 * (decisión señalada: la spec no asigna rol explícito a M04).
 */
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Post()
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  create(@Body() dto: CreateClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.create(dto, user);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.clients.findAll(q);
  }

  /** I29: pedidos, despachos y devoluciones del cliente (Generador/Admin). */
  @Get(':id/resumen')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  resumen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.resumen(id, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.findOne(id, user);
  }

  /** QA Func. 4.1: direcciones de despacho del cliente (consulta: todos los roles). */
  @Get(':id/direcciones')
  listAddresses(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.listAddresses(id);
  }

  @Post(':id/direcciones')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  addAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.addAddress(id, dto, user);
  }

  @Patch(':id/direcciones/:addressId')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  updateAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.updateAddress(id, addressId, dto, user);
  }

  @Post(':id/direcciones/:addressId/eliminar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  removeAddress(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.removeAddress(id, addressId, user);
  }

  @Patch(':id')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.clients.update(id, dto, user);
  }
}
