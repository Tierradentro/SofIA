import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OcrService } from './ocr.service';
import { ProcessOcrDto, SetEngineDto } from './dto/ocr.dto';
import { OcrDocumentStatus } from './entities/ocr-document.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UploadedFilePayload } from '../documents/documents.service';

/**
 * HU-018/020/021, CU-009: procesamiento OCR configurable.
 * Motor activo: Administrador. Procesamiento: Generador/Administrador.
 */
@Controller('ocr')
export class OcrController {
  constructor(private readonly ocr: OcrService) {}

  @Get('engine')
  getEngine() {
    return this.ocr.getActiveEngine().then((engine) => ({ engine }));
  }

  /** HU-020: selección del motor activo (auditada, con precondiciones M13). */
  @Post('engine')
  @Roles(Role.ADMINISTRADOR)
  setEngine(@Body() dto: SetEngineDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ocr.setActiveEngine(dto.engine, user, dto.motivo);
  }

  /** HU-018: probar procesamiento con el motor activo (sin persistir). */
  @Post('test')
  @Roles(Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  test(
    @Body() dto: ProcessOcrDto,
    @UploadedFile() file: UploadedFilePayload,
  ) {
    return this.ocr.testProcess(dto.tipoDocumento, file);
  }

  /** HU-021: procesar documento → estado Creado con vista editable. */
  @Post('documents')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  process(
    @Body() dto: ProcessOcrDto,
    @UploadedFile() file: UploadedFilePayload,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ocr.process(dto.tipoDocumento, file, user, dto.empresaId);
  }

  @Get('documents')
  findAll(@Query('estado') estado?: OcrDocumentStatus) {
    if (estado && !Object.values(OcrDocumentStatus).includes(estado)) {
      throw new BadRequestException('estado inválido');
    }
    return this.ocr.findAll(estado);
  }

  @Get('documents/:id')
  getDetalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.ocr.getDetalle(id);
  }

  /** HU-021: corrección manual de datos extraídos. */
  @Patch('documents/:id')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('datosExtraidos') datos: Record<string, any>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.ocr.correct(id, datos, user);
  }

  @Post('documents/:id/confirm')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  confirm(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ocr.confirm(id, user);
  }

  /** M13: solo documentos temporales confirmados. */
  @Delete('documents/:id')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.ocr.remove(id, user);
  }
}
