import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
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
import { FileInterceptor } from '@nestjs/platform-express';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AssignBarcodeDto } from './dto/assign-barcode.dto';
import { UploadedFilePayload } from '../documents/documents.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/**
 * M05 Productos. Crear/editar: solo Generador (matriz §4).
 * Asociar código de barras: Operador y Generador (HU-011/012).
 * Consulta: todos los roles autenticados (necesaria para pedidos, M08).
 */
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** HU-009 */
  @Post()
  @Roles(Role.GENERADOR)
  create(@Body() dto: CreateProductDto, @CurrentUser() user: AuthenticatedUser) {
    return this.products.create(dto, user);
  }

  /** Listado por empresa (dashboard de existencias). I26: conStock=true limita a productos con existencias (creación/edición de pedidos). */
  @Get()
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  findByEmpresa(
    @Query('empresaId') empresaId: string,
    @Query('conStock') conStock?: string,
  ) {
    return this.products.findByEmpresa(empresaId, true, conStock === 'true');
  }

  /** HU-013: consulta por código de barras, código, OE o referencia cruzada. */
  @Get('lookup/:codigo')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  lookup(@Param('codigo') codigo: string, @Query('empresaId') empresaId?: string) {
    return this.products.lookup(codigo, empresaId);
  }

  /** Búsqueda por descripción (pg_trgm — criterio predominante). */
  @Get('search')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  search(@Query('q') q: string, @Query('empresaId') empresaId?: string) {
    return this.products.search(q || '', empresaId);
  }

  @Get(':id')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const product = await this.products.findById(id);
    return this.products.detalle(product);
  }

  @Patch(':id')
  @Roles(Role.GENERADOR)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.update(id, dto, user);
  }

  /** HU-011 (origen ESCANEADO) / HU-012 (origen MANUAL). */
  @Post(':id/barcode')
  @Roles(Role.OPERADOR, Role.GENERADOR)
  assignBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignBarcodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.assignBarcode(id, dto, user);
  }

  /**
   * QA Func. 2.3: corregir un código mal asociado. Reemplazo transaccional
   * (desasocia el actual y asocia el nuevo en una sola operación), con
   * auditoría del valor anterior/nuevo. Solo Generador/Administrador.
   */
  @Put(':id/barcode')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  replaceBarcode(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignBarcodeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.replaceBarcode(id, dto, user);
  }

  /**
   * I41: foto del producto. La cargan los tres roles operativos (Operador,
   * Generador y Administrador); se muestra en la consulta y en la ficha.
   */
  @Post(':id/foto')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR)
  @UseInterceptors(FileInterceptor('file'))
  subirFoto(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: UploadedFilePayload,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.subirFoto(id, file, user);
  }

  /** I41: imagen de la foto (los roles operativos la visualizan; el rol API no). */
  @Get(':id/foto')
  @Roles(Role.OPERADOR, Role.GENERADOR, Role.ADMINISTRADOR, Role.COMERCIAL)
  async verFoto(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { doc, absolutePath } = await this.products.obtenerFoto(id);
    if (!doc || !absolutePath) throw new NotFoundException('El producto no tiene foto');
    res.setHeader('Content-Type', doc.mime);
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(absolutePath).pipe(res);
  }

  /** I41: solo el Operador NO puede eliminar; Generador y Administrador sí. */
  @Delete(':id/foto')
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
  eliminarFoto(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.products.eliminarFoto(id, user);
  }
}
