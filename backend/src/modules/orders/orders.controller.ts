import {
  BadRequestException,
  Body,
  Controller,
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
import { OrdersService } from './orders.service';
import {
  CancelOrderDto,
  CorrectOrderDto,
  CreateOrderDto,
  InvoiceOrderDto,
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
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('empresaId') empresaId?: string,
    @Query('estado') estado?: OrderStatus,
    @Query('clienteId') clienteId?: string,
  ) {
    if (estado && !Object.values(OrderStatus).includes(estado)) {
      throw new BadRequestException('estado inválido');
    }
    const comercialId = user.rol === Role.COMERCIAL ? (user as any).comercialId : undefined;
    return this.orders.findAll(empresaId, estado, clienteId, comercialId);
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
