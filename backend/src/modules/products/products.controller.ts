import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AssignBarcodeDto } from './dto/assign-barcode.dto';
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

  /** Listado por empresa (dashboard de existencias). */
  @Get()
  findByEmpresa(@Query('empresaId') empresaId: string) {
    return this.products.findByEmpresa(empresaId);
  }

  /** HU-013: consulta por código de barras, código, OE o referencia cruzada. */
  @Get('lookup/:codigo')
  lookup(@Param('codigo') codigo: string, @Query('empresaId') empresaId?: string) {
    return this.products.lookup(codigo, empresaId);
  }

  /** Búsqueda por descripción (pg_trgm — criterio predominante). */
  @Get('search')
  search(@Query('q') q: string, @Query('empresaId') empresaId?: string) {
    return this.products.search(q || '', empresaId);
  }

  @Get(':id')
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
}
