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

  @Get(':id/resumen')
  resumen(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.resumen(id, user);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.clients.findOne(id, user);
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
