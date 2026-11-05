import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConciliacionesService } from './conciliaciones.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UploadedFilePayload } from '../documents/documents.service';
import { CAMPOS_CONCILIACION, ETIQUETAS_CAMPO } from './conciliacion-logic';

/**
 * I65h — Conciliaciones WO vs. SofIA. Módulo de Administración, solo
 * perfil Administrador (la información de existencias y precios es sensible).
 */
@Controller('conciliaciones')
export class ConciliacionesController {
  constructor(private readonly conciliaciones: ConciliacionesService) {}

  /** Campos comparables (para armar el mapeo en la UI). */
  @Post('campos')
  @Roles(Role.ADMINISTRADOR)
  campos() {
    return { ...CAMPOS_CONCILIACION, etiquetas: ETIQUETAS_CAMPO };
  }

  /** Paso 1: sube el archivo y devuelve sus columnas. */
  @Post('columnas')
  @Roles(Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  columnas(@UploadedFile() file: UploadedFilePayload) {
    return this.conciliaciones.columnas(file);
  }

  /** Paso 2: ejecuta la conciliación con el mapeo confirmado. */
  @Post()
  @Roles(Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  conciliar(
    @Body('empresaId') empresaId: string,
    @Body('mapeo') mapeo: string,
    @UploadedFile() file: UploadedFilePayload,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!empresaId) throw new BadRequestException('Debe seleccionar la empresa');
    return this.conciliaciones.conciliar(empresaId, mapeo ?? '{}', file, user);
  }
}
