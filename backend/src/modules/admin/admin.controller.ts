import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { CorrectionsService } from './corrections.service';
import { CorrectionDto } from './dto/correction.dto';
import { UpdateParamDto } from './dto/update-param.dto';
import { ParamsService } from '../params/params.service';
import { AuditService } from '../audit/audit.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/** M14 Administración — correcciones controladas (HU-064) y parámetros. */
@Controller('admin')
@Roles(Role.ADMINISTRADOR)
export class AdminController {
  constructor(
    private readonly corrections: CorrectionsService,
    private readonly params: ParamsService,
    private readonly audit: AuditService,
  ) {}

  @Get('corrections/catalog')
  catalog() {
    return this.corrections.listCorrectible();
  }

  @Post('corrections')
  correct(@Body() dto: CorrectionDto, @CurrentUser() admin: AuthenticatedUser) {
    return this.corrections.correct(dto, admin);
  }

  /** M14: consulta de parámetros del sistema. */
  @Get('params')
  getParams() {
    return this.params.findAll();
  }

  /** M14: actualización de parámetro con motivo obligatorio (auditado). */
  @Put('params/:clave')
  updateParam(
    @Param('clave') clave: string,
    @Body() dto: UpdateParamDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.params.update(clave, dto.valor, dto.motivo, admin, this.audit);
  }
}
