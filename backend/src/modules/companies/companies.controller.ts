import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * M03 Empresas. La consulta es para todos los roles autenticados
 * (todos los usuarios tienen acceso a las empresas, M02);
 * crear/editar es exclusivo del Administrador.
 */
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  @Roles(Role.ADMINISTRADOR)
  create(@Body() dto: CreateCompanyDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.companies.create(dto, admin);
  }

  @Get()
  findAll() {
    return this.companies.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.companies.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMINISTRADOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.companies.update(id, dto, admin);
  }
}
