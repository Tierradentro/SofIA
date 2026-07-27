import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { AuditService } from './audit.service';
import { AuditPurgeService } from './audit-purge.service';
import { QueryAuditDto } from './dto/query-audit.dto';
import { PurgeAuditDto } from './dto/purge-audit.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * Auditoría (M15): consulta y purga — solo rol Administrador (HU-065, A-03).
 */
@Controller('audit')
@Roles(Role.ADMINISTRADOR)
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly purgeService: AuditPurgeService,
  ) {}

  /** HU-065: filtrar por usuario, módulo/tabla, fecha, entidad y acción. */
  @Get()
  query(@Query() q: QueryAuditDto) {
    return this.auditService.query(q);
  }

  /** A-03: purga con exportación previa obligatoria y auto-auditoría. */
  @Post('purge')
  purge(@Body() dto: PurgeAuditDto, @CurrentUser() user: AuthenticatedUser) {
    return this.purgeService.purge(
      dto.fechaDesde,
      dto.fechaHasta,
      dto.motivo,
      { id: user.id, username: user.username },
    );
  }

  /**
   * I14 (tu decisión #4): descarga del respaldo CSV que la purga generó antes
   * de borrar — la salvaguarda se baja desde el módulo, sin tocar la BD.
   */
  @Get('purge/:archivo')
  descargarRespaldo(@Param('archivo') archivo: string, @Res() res: Response) {
    const filePath = this.purgeService.resolveExportPath(archivo);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${archivo}"`,
    );
    res.sendFile(filePath);
  }

  /** Lista los respaldos de purga disponibles para descargar. */
  @Get('purge')
  listarRespaldos() {
    return this.purgeService.listExports();
  }
}
