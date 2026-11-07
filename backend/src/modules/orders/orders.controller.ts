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
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { OrdersService } from './orders.service';
import {
  AdjustPricesDto,
  AjusteFacturaDto,
  CancelOrderDto,
  CorrectOrderDto,
  CreateOrderDto,
  InvoiceOrderDto,
  SaveOrderDraftDto,
  ScanPickDto,
} from './dto/order.dto';
import { OrderStatus } from './entities/order.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UploadedFilePayload } from '../documents/documents.service';
import { parseLimiteLista, parsePaginaLista } from '../../common/utils/limite-lista';

/**
 * M08 (EP-07): pedidos y alistamiento.
 * Creación: Generador/Operador/Comercial (HU-028). Alistamiento: Operador.
 * Corrección: creador del pedido. Factura/aprobación y cancelación: Generador.
 */
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** HU-028: crear pedido (manual, OCR o API). */
  @Post()
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.create(dto, user);
  }

  /** HU-028 (Excel): columnas Referencia/Cantidad (+ encabezado en campos). */
  @Post('excel')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  createFromExcel(
    @Body() dto: Omit<CreateOrderDto, 'items'>,
    @UploadedFile() file: UploadedFilePayload,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.createFromExcel(file, dto, user);
  }

  // I14 (M-7): los listados y detalles internos exigen rol de la aplicación;
  // un usuario API autenticado no debe navegar los pedidos del WMS
  @Get()
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('empresaId') empresaId?: string,
    @Query('estado') estado?: OrderStatus,
    @Query('clienteId') clienteId?: string,
    @Query('limite') limite?: string,
    @Query('pagina') pagina?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (estado && !Object.values(OrderStatus).includes(estado)) {
      throw new BadRequestException('estado inválido');
    }
    const comercialId = user.rol === Role.COMERCIAL ? (user as any).comercialId : undefined;
    // I43: las listas pueden pedir 100, 500 o todos (limite=0) los registros.
    // I56: con pagina se navega el resultado; X-Total-Count informa el total.
    const { items, total } = await this.orders.findAll(
      empresaId,
      estado,
      clienteId,
      comercialId,
      parseLimiteLista(limite),
      parsePaginaLista(pagina),
    );
    res?.setHeader('X-Total-Count', String(total));
    return items;
  }

  /** I67: mis borradores de digitación (el pedido aún no existe ni tiene número). */
  @Get('drafts')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  listarBorradores(@CurrentUser() user: AuthenticatedUser) {
    return this.orders.listarBorradores(user);
  }

  /** I67: guardado automático — crea el borrador del formulario. */
  @Post('drafts')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  guardarBorrador(@Body() dto: SaveOrderDraftDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.guardarBorrador(dto, user);
  }

  /** I67: guardado automático — actualiza el contenido del borrador. */
  @Put('drafts/:id')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  actualizarBorrador(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveOrderDraftDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.actualizarBorrador(id, dto, user);
  }

  /** I67: descarta el borrador (empezar de cero). */
  @Delete('drafts/:id')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  eliminarBorrador(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.eliminarBorrador(id, user);
  }

  /**
   * I67: crea el pedido desde el borrador — AQUÍ se asigna el consecutivo
   * SIGLAS-#### (el borrador nunca lo tuvo) y el borrador se elimina.
   */
  @Post('drafts/:id/confirmar')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  confirmarBorrador(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.confirmarBorrador(id, user);
  }

  /** HU-029: pedido con productos y cantidades a alistar. */
  @Get(':id')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  getDetalle(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.getDetalle(id, user);
  }

  /** HU-030/HU-031: escaneo de alistamiento (modos INICIAL/COMPLETO). */
  @Post(':id/scan')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ScanPickDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.scan(id, dto, user);
  }

  /** Operador confirma el alistamiento completo → ALISTADO. */
  @Post(':id/finalizar-picking')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  finalizarPicking(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.finalizarPicking(id, user);
  }

  /**
   * I65b: devuelve un pedido ALISTADO a ABIERTO para correcciones.
   * Disponible para todos los perfiles. Las unidades alistadas salen de la
   * bahía de empaque de regreso a su ubicación y se liberan los bloqueos.
   */
  @Post(':id/revertir-alistamiento')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  revertirAlistamiento(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.revertirAlistamiento(id, user);
  }

  /** Producto no encontrado o cantidades inferiores → Pendiente_Corrección. */
  @Post(':id/reportar')
  @Roles(Role.OPERADOR, Role.ADMINISTRADOR)
  reportar(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.reportar(id, user);
  }

  /** Corrección del creador (agregar/eliminar productos) → vuelve a ABIERTO. */
  @Patch(':id')
  @Roles(Role.GENERADOR, Role.OPERADOR, Role.COMERCIAL, Role.ADMINISTRADOR)
  correct(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CorrectOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.correct(id, dto, user);
  }

  /** HU-032: cargar factura de venta (OCR) y aprobar para empaque. */
  @Post(':id/invoice')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  loadInvoice(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.loadInvoice(id, dto.ocrDocumentId, user);
  }

  /**
   * I69: revisión del ajuste contra la factura corregida (pedido Aprobado o
   * Despachado). Muestra los cambios por ítem sin aplicar nada.
   */
  @Post(':id/ajuste-factura/preview')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  preverAjusteFactura(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InvoiceOrderDto,
  ) {
    return this.orders.preverAjusteFactura(id, dto.ocrDocumentId);
  }

  /**
   * I69: aplica el ajuste aprobado: las unidades de más retornan al
   * inventario y se retiran de las cajas del despacho (incluidas las
   * cerradas). Solo Generador/Administrador.
   */
  @Post(':id/ajuste-factura')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  ajustarPorFactura(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AjusteFacturaDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.ajustarPorFactura(id, dto, user);
  }

  /**
   * I61: ajuste de precios del pedido — solo Administrador y sin importar el
   * estado (Alistado, Aprobado, Despachado…). Auditado con antes/después.
   */
  @Patch(':id/precios')
  @Roles(Role.ADMINISTRADOR)
  adjustPrices(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdjustPricesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.adjustPrices(id, dto, user);
  }
  /** Cancelación (Generador): libera las cantidades bloqueadas. */
  @Post(':id/cancel')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.cancel(id, dto.motivo, user);
  }
}
