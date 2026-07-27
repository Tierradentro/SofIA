import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/** M02 Usuarios — gestión exclusiva del Administrador. */
@Controller('users')
@Roles(Role.ADMINISTRADOR)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.users.create(dto, admin);
  }

  @Get()
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.users.update(id, dto, admin);
  }

  /** HU-005 */
  @Patch(':id/estado')
  setEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.users.setEstado(id, dto, admin);
  }

  /** Recuperación de contraseña (P-07): reseteo por administrador. */
  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.users.resetPassword(id, admin);
  }
}
