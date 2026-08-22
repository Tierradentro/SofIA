import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
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
import { LabelPrintDto } from './dto/label-print.dto';

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
   * HU-007 / I25: página de etiqueta 50×30 mm lista para el diálogo de
   * impresión del navegador. Recibe el código de la caja y el código de
   * barras como data URL (el barras contiene únicamente el box_id), más el
   * número de despacho y la(s) empresa(s) para el encabezado.
   */
  @Get('label')
  @Header('Content-Type', 'text/html; charset=utf-8')
  label(
    @Query('boxCode') boxCode: string,
    @Query('barcode') barcode: string,
    @Query('despacho') despacho?: string,
    @Query('empresas') empresas?: string,
  ) {
    if (!boxCode || !barcode) {
      throw new BadRequestException('boxCode y barcode son requeridos');
    }
    if (!barcode.startsWith('data:image/')) {
      throw new BadRequestException('El código de barras debe ser un data URL de imagen');
    }
    return this.documents.buildLabelHtml(boxCode, barcode, despacho, empresas);
  }

  /**
   * I27: variante POST usada por el botón Imprimir del despacho. El barras
   * viaja en el cuerpo (evita URL de varios KB que los proxies pueden
   * rechazar) y el frontend la llama con fetch autenticado, por lo que ya
   * no depende de window.open (que no puede enviar el token y recibía 401).
   */
  @Post('label')
  @HttpCode(200)
  @Header('Content-Type', 'text/html; charset=utf-8')
  labelPrint(@Body() dto: LabelPrintDto) {
    return this.documents.buildLabelHtml(
      dto.boxCode,
      dto.barcode,
      dto.despacho,
      dto.empresas,
    );
  }
}
