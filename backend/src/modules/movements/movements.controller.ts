import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { MovementsService } from './movements.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

/**
 * Consulta de movimientos de inventario (trazabilidad M18).
 * La escritura es interna: la invocan los módulos de ingreso, pedidos,
 * despachos, inventarios, devoluciones e importaciones.
 */
@Controller('movements')
@Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Get('producto/:id')
  byProduct(@Param('id', ParseUUIDPipe) id: string) {
    return this.movements.byProduct(id);
  }

  @Get('producto/:id/reconcile')
  reconcile(@Param('id', ParseUUIDPipe) id: string) {
    return this.movements.reconcile(id);
  }

  @Get()
  byEmpresa(@Query('empresaId') empresaId: string) {
    return this.movements.byEmpresa(empresaId);
  }
}
