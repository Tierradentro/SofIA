import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportsService } from './imports.service';
import { CreateImportDto } from './dto/create-import.dto';
import { ImportType, IMPORT_FIELDS } from '../../common/enums/import-type.enum';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UploadedFilePayload } from '../documents/documents.service';

/**
 * M18 / EP-04: importación desde la maestra contable.
 * Carga: Generador (y Administrador). Aprobación de CANTIDADES: Administrador.
 */
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  /** Catálogo de campos destino por tipo (para el mapeo declarativo en UI). */
  @Get('fields')
  fields() {
    return IMPORT_FIELDS;
  }

  @Post()
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Body() dto: CreateImportDto,
    @UploadedFile() file: UploadedFilePayload,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.imports.upload(dto, file, user);
  }

  @Get()
  findAll(@Query('tipo') tipo?: ImportType) {
    return this.imports.findAll(tipo);
  }

  /** HU-016: resumen de validación con diferencias. */
  @Get(':id/resumen')
  resumen(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getResumen(id);
  }

  /** Aprobación: CANTIDADES requiere Administrador (M18). */
  @Post(':id/approve')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.imports.approve(id, user);
  }

  @Post(':id/reject')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('motivo') motivo: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.imports.reject(id, user, motivo);
  }
}
