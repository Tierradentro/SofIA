import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MovementsService } from './movements.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { parseLimiteLista, parsePaginaLista } from '../../common/utils/limite-lista';

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
  async byEmpresa(
    @Query('empresaId') empresaId: string,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    // I43: las listas pueden pedir 100, 500 o todos (limite=0) los registros.
    // I56: con pagina se navega el resultado; X-Total-Count informa el total.
    const { items, total } = await this.movements.byEmpresa(
      empresaId,
      parseLimiteLista(limite),
      parsePaginaLista(pagina),
    );
    res?.setHeader('X-Total-Count', String(total));
    return items;
  }
}
