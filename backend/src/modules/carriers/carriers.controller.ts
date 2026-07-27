import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CarriersService } from './carriers.service';
import { CreateCarrierDto } from './dto/create-carrier.dto';
import { UpdateCarrierDto } from './dto/update-carrier.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * HU-008: gestión de transportadoras (Administrador).
 * La consulta de activas la usan Operador/Generador al registrar guías (M09).
 */
@Controller('carriers')
export class CarriersController {
  constructor(private readonly carriers: CarriersService) {}

  @Post()
  @Roles(Role.ADMINISTRADOR)
  create(@Body() dto: CreateCarrierDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.carriers.create(dto, admin);
  }

  /** Listado completo (gestión) — Administrador. */
  @Get()
  @Roles(Role.ADMINISTRADOR)
  findAll() {
    return this.carriers.findAll();
  }

  /** Listado operativo para registro de guías — roles operativos. */
  @Get('activas')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  findActivas() {
    return this.carriers.findActivas();
  }

  @Get(':id')
  @Roles(Role.ADMINISTRADOR)
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.carriers.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMINISTRADOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCarrierDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.carriers.update(id, dto, admin);
  }
}
