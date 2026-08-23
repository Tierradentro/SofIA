import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { OrdersService } from '../orders/orders.service';
import { CreateOrderDto } from '../orders/dto/order.dto';
import { DispatchesService } from '../dispatches/dispatches.service';
import { ClientsService } from '../clients/clients.service';
import { ComercialesService } from '../comerciales/comerciales.service';
import { CompaniesService } from '../companies/companies.service';
import { ProductsService } from '../products/products.service';
import { TransportType } from '../dispatches/entities/dispatch.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';

/** HU-063 / spec §7: registro de guía de transportadora por API. */
export class CarrierGuideDto {
  @IsString()
  @IsNotEmpty()
  numero: string;

  @IsUUID()
  carrierId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  guia: string;

  /** Opcional; por defecto la fecha actual (HU-063: validar fecha). */
  @IsOptional()
  @IsString()
  fechaSalida?: string;
}

/**
 * EP-12 (spec §7): API externa para sistemas integrados y ambientes
 * agénticos. Autenticación por header X-API-Key (M17) con rate limit
 * parametrizable; todos los endpoints exigen rol API.
 *
 * Endpoints (nomenclatura de la spec):
 *   POST /api/orders              — crear pedido (HU-060)
 *   PUT  /api/orders/{id}         — modificar pedido ABIERTO creado por API
 *   GET  /api/products            — productos y cantidades (HU-061)
 *   GET  /api/products/search     — búsqueda parcial por texto (I29)
 *   GET  /api/dispatch/{numero}   — estado del despacho (HU-062)
 *   POST /api/carrier-guide       — registrar guía (HU-063)
 *   GET  /api/carrier-guide/{numero} — consultar guía registrada
 *   GET  /api/box/{boxId}         — consulta de caja (contenido resuelto)
 *   GET  /api/clients             — búsqueda de clientes por nombre/NIT (I29)
 *   GET  /api/comerciales         — búsqueda de comerciales (I29)
 *   GET  /api/companies           — empresas activas (I29)
 */
@Controller('api')
@Roles(Role.API)
export class ExternalApiController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly orders: OrdersService,
    private readonly dispatches: DispatchesService,
    private readonly clientsService: ClientsService,
    private readonly comercialesService: ComercialesService,
    private readonly companiesService: CompaniesService,
    private readonly productsService: ProductsService,
  ) {}

  /**
   * HU-060: crear pedido. Valida empresa, cliente, productos y cantidades
   * (mismas reglas del flujo manual, M08). Queda marcado created_via='API'.
   */
  @Post('orders')
  crearPedido(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.create(dto, user as any, 'API');
  }

  /**
   * Spec §7: modificar pedido — solo en estado Abierto y creado por esta
   * vía (403 si no fue creado por API; 409 si ya no está Abierto).
   */
  @Put('orders/:id')
  modificarPedido(
    @Param('id') id: string,
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orders.updateFromApi(id, dto, user as any);
  }

  /** HU-061: productos y cantidades; filtra por empresa, código y disponibilidad. */
  @Get('products')
  async productos(
    @Query('empresaId') empresaId: string,
    @Query('codigo') codigo?: string,
    @Query('disponibles') disponibles?: string,
  ) {
    if (!empresaId) throw new BadRequestException('empresaId es requerido');
    const empresa = await this.dataSource
      .getRepository('companies')
      .findOne({ where: { id: empresaId } });
    if (!empresa) throw new BadRequestException('Empresa no encontrada');

    const params: any[] = [empresaId];
    let where = 'empresa_id = $1';
    if (codigo?.trim()) {
      params.push(codigo.trim().toUpperCase());
      where += ` AND (UPPER(codigo) = $2 OR UPPER(COALESCE(codigo_oe,'')) = $2
        OR UPPER(COALESCE(ref_cruzada_1,'')) = $2 OR UPPER(COALESCE(ref_cruzada_2,'')) = $2)`;
    }
    const rows: any[] = await this.dataSource.query(
      `SELECT codigo, descripcion, marca, unidad_medida AS "unidadMedida",
              cantidad, cantidad_bloqueada AS "cantidadBloqueada",
              (cantidad - cantidad_bloqueada) AS disponible,
              precio, estado, ubicacion
       FROM products WHERE ${where} ORDER BY codigo`,
      params,
    );
    const soloDisponibles = disponibles === 'true';
    return rows
      .filter((r) => !soloDisponibles || r.disponible > 0)
      .map((r) => ({ ...r, empresa: (empresa as any).nombre }));
  }

  /**
   * I29: búsqueda parcial de productos por texto (pg_trgm), la misma que usa
   * el frontend interno. Permite al agente resolver "filtro de aceite para
   * Chevrolet Spark" sin conocer el código exacto.
   */
  @Get('products/search')
  async buscarProductos(
    @Query('q') q: string,
    @Query('empresaId') empresaId?: string,
    @Query('limite') limite?: string,
  ) {
    if (!q?.trim()) throw new BadRequestException('q es requerido');
    const resultados = await this.productsService.search(
      q,
      empresaId || undefined,
      limite ? parseInt(limite, 10) : 25,
    );
    return resultados.map((p: any) => ({
      codigo: p.codigo,
      descripcion: p.descripcion,
      marca: p.marca,
      unidadMedida: p.unidadMedida,
      cantidad: p.cantidad,
      cantidadBloqueada: p.cantidadBloqueada,
      disponible: p.cantidad - (p.cantidadBloqueada ?? 0),
      precio: p.precio,
      ubicacion: p.ubicacion,
    }));
  }

  /**
   * I29: búsqueda de clientes por nombre o identificación — el agente
   * resuelve el UUID que exige POST /api/orders sin salir de la API.
   */
  @Get('clients')
  clientes(@Query('q') q?: string) {
    return this.clientsService.findAll(q);
  }

  /** I29: búsqueda de comerciales por nombre o identificación. */
  @Get('comerciales')
  comerciales(@Query('q') q?: string) {
    return this.comercialesService.findAll(q);
  }

  /** I29: empresas activas — el agente descubre los empresaId válidos. */
  @Get('companies')
  empresas() {
    return this.companiesService.findAll();
  }

  /** HU-062: estado y detalle del despacho (cajas, productos, guías). */
  @Get('dispatch/:numero')
  async despacho(@Param('numero') numero: string) {
    const d = await this.dispatches.getByNumero(numero);
    return {
      numero: d.numero,
      estado: d.estado,
      cliente: d.cliente,
      pedidos: d.pedidos.map((p: any) => ({
        numero: p.numero,
        numeroFactura: p.numeroFactura,
        items: p.items.map((i: any) => ({
          codigo: i.codigo,
          descripcion: i.descripcion,
          cantidadAlistada: i.cantidadAlistada,
          cantidadDespachada: i.cantidadDespachada,
        })),
      })),
      cajas: d.cajas.map((c: any) => ({
        boxId: c.boxId,
        numeroEnDespacho: c.numeroEnDespacho,
        estado: c.estado,
        items: c.items.map((i: any) => ({ codigo: i.codigo, cantidad: i.cantidad })),
      })),
      transporte: {
        tipo: d.tipoTransporte,
        nombreTransporte: d.nombreTransporte,
        guia: d.guia,
        fechaSalida: d.fechaSalida,
      },
      despachoOrigenId: d.despachoOrigenId,
    };
  }

  /** HU-063: registrar guía de transportadora (salida EXTERNA → DESPACHADO). */
  @Post('carrier-guide')
  async registrarGuia(
    @Body() dto: CarrierGuideDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (dto.fechaSalida && isNaN(Date.parse(dto.fechaSalida))) {
      throw new BadRequestException('fechaSalida inválida (use ISO 8601)');
    }
    const d = await this.dispatches.getByNumero(dto.numero);
    return this.dispatches.registerTransport(
      d.id,
      { tipo: TransportType.EXTERNA, carrierId: dto.carrierId, guia: dto.guia },
      user as any,
    );
  }

  /** Consulta la guía registrada de un despacho. */
  @Get('carrier-guide/:numero')
  async consultarGuia(@Param('numero') numero: string) {
    const d = await this.dispatches.getByNumero(numero);
    return {
      numero: d.numero,
      estado: d.estado,
      tipo: d.tipoTransporte,
      nombreTransporte: d.nombreTransporte,
      guia: d.guia,
      fechaSalida: d.fechaSalida,
    };
  }

  /** Spec §7: consulta de caja — el QR contiene solo box_id; aquí se resuelve. */
  @Get('box/:boxId')
  consultaCaja(@Param('boxId') boxId: string) {
    return this.dispatches.consultaCaja(boxId);
  }
}
