import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { PqrsService } from './pqrs.service';
import {
  CancelPqrsCaseDto,
  ClosePqrsCaseDto,
  CorrectPqrsCaseDto,
  CreatePqrsCaseDto,
  ReingresoDto,
  RequestCorrectionDto,
  SupportMetaDto,
} from './dto/pqrs.dto';
import { PqrsStatus } from './entities/pqrs-case.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UploadedFilePayload } from '../documents/documents.service';

/**
 * M11 (EP-08): devoluciones (PQRS).
 * Creación, recepción, soportes y solución: Operador.
 * Corrección, cancelación y reingreso al inventario: Generador.
 */
@Controller('pqrs')
export class PqrsController {
  constructor(private readonly pqrs: PqrsService) {}

  /** Catálogo de motivos (G01–G40 / N01–N18). */
  @Get('motivos')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  motivos() {
    return this.pqrs.listReasons();
  }

  /** HU-044: búsqueda por producto, caja, factura o despacho. */
  @Get('buscar')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  buscar(
    @Query('codigo') codigo?: string,
    @Query('boxId') boxId?: string,
    @Query('factura') factura?: string,
    @Query('despacho') despacho?: string,
  ) {
    return this.pqrs.buscar({ codigo, boxId, factura, despacho });
  }

  /** HU-043: crear caso (Operador) → ABIERTA. */
  @Post()
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  create(@Body() dto: CreatePqrsCaseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.pqrs.create(dto, user);
  }

  /** HU-046: adjuntar soporte fotográfico con observación. */
  @Post(':id/soportes')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  addSupport(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() meta: SupportMetaDto,
    @UploadedFile() file: UploadedFilePayload,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pqrs.addSupport(id, meta, file, user);
  }

  /** Descarga de soporte (imagen almacenada). */
  @Get('soportes/:supportId/archivo')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  async getSupportFile(@Param('supportId', ParseUUIDPipe) supportId: string, @Res() res: Response) {
    const { doc, absolutePath } = await this.pqrs.getSupportFile(supportId);
    if (!doc) throw new NotFoundException('Archivo no encontrado');
    res.setHeader('Content-Type', doc.mime);
    createReadStream(absolutePath).pipe(res);
  }

  /** M11: solicitar corrección (Operador) → PENDIENTE_CORRECCION. */
  @Post(':id/solicitar-correccion')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  solicitarCorreccion(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RequestCorrectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pqrs.solicitarCorreccion(id, dto, user);
  }

  /** M11: Generador corrige y devuelve el caso → ABIERTA. */
  @Post(':id/corregir')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  corregir(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectPqrsCaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pqrs.corregir(id, dto, user);
  }

  /** M11 Solución: Operador registra el resultado y cierra → CERRADA. */
  @Post(':id/cerrar')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  cerrar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ClosePqrsCaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pqrs.cerrar(id, dto, user);
  }

  /** Cancelación (Generador, en cualquier parte del flujo). */
  @Post(':id/cancelar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPqrsCaseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pqrs.cancel(id, dto, user);
  }

  /** M11: reingreso manual al inventario (movimiento REINGRESO_DEVOLUCION). */
  @Post(':id/reingresar')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  reingresar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReingresoDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.pqrs.reingresar(id, dto, user);
  }

  @Get()
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('estado') estado?: PqrsStatus,
    @Query('clienteId') clienteId?: string,
  ) {
    // Tablero del comercial (M02)
    const comercialId = user.rol === Role.COMERCIAL ? (user as any).comercialId : undefined;
    return this.pqrs.list({ estado, clienteId, comercialId });
  }

  @Get(':id')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.pqrs.get(id, user);
  }
}
