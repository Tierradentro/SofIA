import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { OcrProvidersService } from './ocr-providers.service';
import { CreateOcrProviderDto, UpdateOcrProviderDto } from './dto/ocr.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * HU-019: administración de proveedores LLM para OCR (solo Administrador).
 */
@Controller('ocr-providers')
@Roles(Role.ADMINISTRADOR)
export class OcrProvidersController {
  constructor(private readonly providers: OcrProvidersService) {}

  @Get()
  findAll() {
    return this.providers.findAll();
  }

  @Post()
  create(@Body() dto: CreateOcrProviderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.providers.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOcrProviderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.providers.update(id, dto, user);
  }

  /** M13: solo un proveedor activo; la activación desactiva al anterior. */
  @Post(':id/activate')
  activate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.providers.activate(id, user);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.providers.deactivate(id, user);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.providers.remove(id, user);
  }
}
