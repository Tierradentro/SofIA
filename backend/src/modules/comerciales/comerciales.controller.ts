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
import { ComercialesService } from './comerciales.service';
import { CreateComercialDto, UpdateComercialDto } from './dto/comercial.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * M06 Comerciales (catálogo global). Consulta: todos los roles (los pedidos
 * llevan comercial). Crear/editar: solo Administrador (decisión QA Func. 3.5).
 */
@Controller('comerciales')
export class ComercialesController {
  constructor(private readonly comerciales: ComercialesService) {}

  @Post()
  @Roles(Role.ADMINISTRADOR)
  create(@Body() dto: CreateComercialDto, @CurrentUser() user: AuthenticatedUser) {
    return this.comerciales.create(dto, user);
  }

  @Get()
  findAll(@Query('q') q?: string) {
    return this.comerciales.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.comerciales.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMINISTRADOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateComercialDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.comerciales.update(id, dto, user);
  }
}
