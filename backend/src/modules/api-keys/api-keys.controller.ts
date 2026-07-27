import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/** M17: gestión de API keys — solo Administrador. Consulta enmascarada. */
@Controller('api-keys')
@Roles(Role.ADMINISTRADOR)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  @Post()
  create(@Body() dto: CreateApiKeyDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.apiKeys.create(dto, admin);
  }

  @Get()
  findAll() {
    return this.apiKeys.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.apiKeys.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApiKeyDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.apiKeys.update(id, dto, admin);
  }

  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: AuthenticatedUser) {
    return this.apiKeys.remove(id, admin);
  }
}
