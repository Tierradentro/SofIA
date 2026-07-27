import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { DocumentsService, UploadedFilePayload } from './documents.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /** HU-006: configurar logo empresarial (solo Administrador). */
  @Post('logo')
  @Roles(Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  uploadLogo(
    @UploadedFile() file: UploadedFilePayload,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.documents.uploadLogo(file, admin);
  }

  /** Logo activo (público para la pantalla de login). */
  @Public()
  @Get('logo')
  async getLogo(@Res() res: Response) {
    const logo = await this.documents.getLogo();
    if (!logo || !existsSync(logo.absolutePath)) {
      throw new NotFoundException('No hay logo configurado');
    }
    res.setHeader('Content-Type', logo.doc.mime);
    createReadStream(logo.absolutePath).pipe(res);
  }

  /**
   * HU-007: página de etiqueta 50×30 mm lista para el diálogo de impresión
   * del navegador. Recibe el código y el QR como data URL (el QR contiene
   * únicamente el box_id — verificación en I8).
   */
  @Get('label')
  @Header('Content-Type', 'text/html; charset=utf-8')
  label(@Query('boxCode') boxCode: string, @Query('qr') qr: string) {
    if (!boxCode || !qr) {
      throw new BadRequestException('boxCode y qr son requeridos');
    }
    if (!qr.startsWith('data:image/')) {
      throw new BadRequestException('El QR debe ser un data URL de imagen');
    }
    return this.documents.buildLabelHtml(boxCode, qr);
  }
}
