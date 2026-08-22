import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { Order, OrderStatus } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderCounter } from './entities/order-counter.entity';
import {
  CancelOrderDto,
  CorrectOrderDto,
  CreateOrderDto,
  OrderItemDto,
  PickMode,
  ScanPickDto,
} from './dto/order.dto';
import { Product } from '../products/entities/product.entity';
import { ProductBarcode } from '../products/entities/product-barcode.entity';
import { ProductsService } from '../products/products.service';
import { OcrDocument } from '../ocr/entities/ocr-document.entity';
import { ClientAddress } from '../clients/entities/client-address.entity';
import { Client } from '../clients/entities/client.entity';
import { DocumentType } from '../../common/enums/document-type.enum';
import { MovementsService } from '../movements/movements.service';
import { MovementType } from '../../common/enums/movement-type.enum';
import { AuditService } from '../audit/audit.service';
import { User } from '../users/entities/user.entity';
import { InventoriesService } from '../inventories/inventories.service';
import { InboundMatcher } from '../inbound/inbound-matcher';
import { compararFacturaConPedido } from './order-compare';
import { BarcodeOrigin } from '../../common/enums/barcode-origin.enum';
import { Role } from '../../common/enums/role.enum';

const TABLA = 'Pedidos';

type Usuario = { id: string; username: string; rol?: string; comercialId?: string | null };

interface ItemResuelto {
  producto: Product;
  cantidad: number;
  valorUnidad: number;
}

/**
 * M08/EP-07: pedidos y alistamiento.
 * Ciclo (respuesta 4.2): ABIERTO → ALISTADO → APROBADO, con
 * PENDIENTE_CORRECCION (permite agregar/eliminar productos) y CANCELADO.
 * - Creación (HU-028): manual, OCR (orden/cotización), Excel o API; valida
 *   disponibilidad (cantidad − bloqueada) y asigna consecutivo SIGLAS-####
 *   independiente por empresa (P-09). Comercial automático para rol Comercial.
 * - Alistamiento (HU-029/030/031): escaneo modo INICIAL/COMPLETO; cada lectura
 *   descuenta el pendiente y bloquea existencias en una transacción
 *   (BLOQUEO_ALISTAMIENTO); alerta excedentes; asocia barcode si no tiene.
 * - Confirmación (HU-032): factura de venta por OCR, comparación estricta;
 *   con diferencias reporta y no cambia estado. Generador aprueba → APROBADO.
 * - Cancelación (Generador): libera las cantidades bloqueadas.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orders: Repository<Order>,
    @InjectRepository(OrderItem)
    private readonly items: Repository<OrderItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly products: ProductsService,
    private readonly movements: MovementsService,
    private readonly audit: AuditService,
    private readonly inventories: InventoriesService,
  ) {}

  // ---------------------------------------------------------------
  // Creación (HU-028)
  // ---------------------------------------------------------------

  async create(
    dto: CreateOrderDto,
    user: Usuario,
    via?: 'MANUAL' | 'OCR' | 'EXCEL' | 'API',
  ) {
    const comercialId = this.resolveComercial(dto, user);
    // H-7: procedencia del pedido (spec §7); por defecto OCR si trae
    // documento OCR, si no MANUAL
    const createdVia = via ?? (dto.ocrDocumentId ? 'OCR' : 'MANUAL');
    let itemsDto = dto.items ?? [];
    let ordenPedido = dto.ordenPedido ?? null;

    if (dto.ocrDocumentId) {
      const ocrDoc = await this.dataSource
        .getRepository(OcrDocument)
        .findOne({ where: { id: dto.ocrDocumentId } });
      if (!ocrDoc) throw new NotFoundException('Documento OCR no encontrado');
      if (
        ocrDoc.tipoDocumento !== DocumentType.ORDEN_PEDIDO &&
        ocrDoc.tipoDocumento !== DocumentType.COTIZACION
      ) {
        throw new BadRequestException(
          'El documento OCR debe ser ORDEN_PEDIDO o COTIZACION',
        );
      }
      const d = ocrDoc.datosExtraidos as any;
      ordenPedido = ordenPedido ?? d.numeroFactura ?? null;
      if (!itemsDto.length && Array.isArray(d.items)) {
        itemsDto = d.items.map((i: any) => ({
          referencia: String(i.referencia ?? ''),
          cantidad: Number(i.cantidad) || 0,
        }));
      }
    }
    if (!itemsDto.length) {
      throw new BadRequestException('El pedido requiere al menos un producto');
    }

    // QA Func. 4.1: dirección de despacho elegida en el pedido (foto)
    let direccionDespacho: string | null = null;
    if (dto.direccionId) {
      const direccion = await this.dataSource
        .getRepository(ClientAddress)
        .findOne({ where: { id: dto.direccionId, activo: true } });
      if (!direccion) throw new NotFoundException('Dirección no encontrada');
      if (direccion.clientId !== dto.clienteId) {
        throw new BadRequestException('La dirección no pertenece al cliente del pedido');
      }
      direccionDespacho = direccion.direccion;
    } else {
      // Sin selección explícita: la principal del cliente (si existe)
      const principal = await this.dataSource
        .getRepository(ClientAddress)
        .findOne({ where: { clientId: dto.clienteId, esPrincipal: true, activo: true } });
      direccionDespacho = principal?.direccion ?? null;
    }

    const resueltos = await this.resolverItems(dto.empresaId, itemsDto);
    const numero = await this.dataSource.transaction(async (em) => {
      const numero = await this.siguienteConsecutivo(em, dto.empresaId);
      const order = await em.save(
        em.create(Order, {
          empresaId: dto.empresaId,
          numero,
          ordenPedido,
          ciudad: dto.ciudad?.trim() || null,
          direccionDespacho,
          clienteId: dto.clienteId,
          comercialId,
          notas: dto.notas?.trim() || null,
          estado: OrderStatus.ABIERTO,
          ocrDocumentId: dto.ocrDocumentId ?? null,
          createdVia,
          createdBy: user.id,
        }),
      );
      for (const r of resueltos) {
        await em.save(
          em.create(OrderItem, {
            orderId: order.id,
            productId: r.producto.id,
            codigo: r.producto.codigo,
            marca: r.producto.marca ?? null,
            descripcion: r.producto.descripcion,
            cantidad: r.cantidad,
            cantidadAlistada: 0,
            valorUnidad: r.valorUnidad,
            valorTotal: r.cantidad * r.valorUnidad,
          }),
        );
      }
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'PEDIDO_CREADO',
          tabla: TABLA,
          registroId: order.id,
          valorNuevo: {
            numero,
            clienteId: dto.clienteId,
            comercialId,
            items: resueltos.map((r) => ({
              codigo: r.producto.codigo,
              cantidad: r.cantidad,
              valorUnidad: r.valorUnidad,
            })),
            origen: createdVia,
          },
        },
        em,
      );
      return numero;
    });
    const creado = await this.orders.findOne({
      where: { empresaId: dto.empresaId, numero },
    });
    return this.getDetalle(creado!.id);
  }

  /** HU-028 (Excel): crea pedido desde archivo con columnas Referencia/Cantidad. */
  async createFromExcel(
    file: { buffer: Buffer; originalname: string },
    dto: Omit<CreateOrderDto, 'items'>,
    user: Usuario,
  ) {
    if (!file) throw new BadRequestException('Archivo Excel requerido');
    let filas: Record<string, unknown>[];
    try {
      const wb = XLSX.read(file.buffer, { type: 'buffer' });
      filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    } catch {
      throw new BadRequestException('No se pudo leer el archivo Excel');
    }
    if (!filas.length) {
      throw new BadRequestException('El archivo no tiene filas de datos');
    }
    const items: OrderItemDto[] = filas.map((f, idx) => {
      const referencia = String(
        f['Referencia'] ?? f['referencia'] ?? f['Codigo'] ?? f['Código'] ?? f['codigo'] ?? '',
      ).trim();
      const cantidad = Number(f['Cantidad'] ?? f['cantidad'] ?? 0);
      if (!referencia || !Number.isInteger(cantidad) || cantidad < 1) {
        throw new BadRequestException(
          `Fila ${idx + 2}: se requiere Referencia y Cantidad entera ≥ 1`,
        );
      }
      const vu = Number(f['ValorUnidad'] ?? f['valor_unidad'] ?? NaN);
      return { referencia, cantidad, valorUnidad: Number.isFinite(vu) ? vu : undefined };
    });
    return this.create({ ...dto, items }, user, 'EXCEL');
  }

  /**
   * H-4 (spec §7): PUT /api/orders/{id} — modifica un pedido SOLO si está
   * ABIERTO y fue creado por la API externa. Reemplaza ítems y datos de
   * cabecera en una transacción.
   */
  async updateFromApi(id: string, dto: CreateOrderDto, user: Usuario) {
    const order = await this.findOne(id);
    if (order.createdVia !== 'API') {
      throw new ForbiddenException(
        'Solo se pueden modificar por esta vía los pedidos creados por la API',
      );
    }
    if (order.estado !== OrderStatus.ABIERTO) {
      throw new ConflictException(
        `Solo se puede modificar un pedido Abierto (actual: ${order.estado})`,
      );
    }
    const itemsDto = dto.items ?? [];
    if (!itemsDto.length) {
      throw new BadRequestException('El pedido requiere al menos un producto');
    }
    const comercialId = this.resolveComercial(dto, user);
    const actuales = await this.items.find({ where: { orderId: id } });
    const resueltos = await this.resolverItems(dto.empresaId, itemsDto, actuales);

    await this.dataSource.transaction(async (em) => {
      await em.delete(OrderItem, { orderId: id });
      for (const r of resueltos) {
        await em.save(
          em.create(OrderItem, {
            orderId: id,
            productId: r.producto.id,
            codigo: r.producto.codigo,
            marca: r.producto.marca ?? null,
            descripcion: r.producto.descripcion,
            cantidad: r.cantidad,
            cantidadAlistada: 0,
            valorUnidad: r.valorUnidad,
            valorTotal: r.cantidad * r.valorUnidad,
          }),
        );
      }
      await em.update(Order, { id }, {
        clienteId: dto.clienteId,
        comercialId,
        ciudad: dto.ciudad?.trim() || null,
        ordenPedido: dto.ordenPedido ?? order.ordenPedido,
        notas: dto.notas?.trim() || null,
      });
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'PEDIDO_MODIFICADO_API',
          tabla: TABLA,
          registroId: id,
          valorAnterior: { items: actuales.map((i) => ({ codigo: i.codigo, cantidad: i.cantidad })) },
          valorNuevo: {
            clienteId: dto.clienteId,
            comercialId,
            items: resueltos.map((r) => ({ codigo: r.producto.codigo, cantidad: r.cantidad })),
          },
        },
        em,
      );
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------
  // Alistamiento (HU-029/030/031)
  // ---------------------------------------------------------------

  /**
   * HU-030: cada lectura cuenta unidades, descuenta el pendiente y bloquea
   * existencias en una transacción. Alerta excedentes. Si el producto no
   * tiene barcode y está seleccionado (modo INICIAL / HU-031), lo asocia.
   */
  async scan(id: string, dto: ScanPickDto, user: Usuario) {
    const order = await this.findOne(id);
    if (order.estado !== OrderStatus.ABIERTO) {
      throw new BadRequestException(
        `Solo se puede alistar un pedido Abierto (actual: ${order.estado})`,
      );
    }
    const cantidad = dto.cantidad ?? 1;
    const items = await this.items.find({ where: { orderId: id } });

    let item: OrderItem | undefined;
    if (dto.modo === PickMode.INICIAL) {
      if (!dto.productId) {
        throw new BadRequestException('En modo INICIAL debe seleccionar el producto (productId)');
      }
      item = items.find((i) => i.productId === dto.productId);
      if (!item) throw new BadRequestException('El producto seleccionado no está en el pedido');
      // HU-031/CU-002: asociar código si el producto no tiene barcode
      const registrados = await this.dataSource
        .getRepository(ProductBarcode)
        .find({ where: { productId: item.productId } });
      if (registrados.length === 0) {
        await this.products.assignBarcode(
          item.productId,
          { barcode: dto.codigo.trim(), origen: BarcodeOrigin.MANUAL },
          user,
        );
      } else if (
        // I26: una vez registrado el código, las siguientes unidades del mismo
        // producto solo cuentan si la lectura coincide con lo registrado
        !registrados.some(
          (b) => b.barcode.trim().toUpperCase() === dto.codigo.trim().toUpperCase(),
        )
      ) {
        throw new BadRequestException({
          statusCode: 400,
          code: 'CODIGO_NO_COINCIDE',
          message: `El código leído no coincide con el código de barras registrado para ${item.codigo}; verifique la etiqueta`,
        });
      }
    } else {
      // MODO COMPLETO: ubicar por barcode; si no, por código/OE/cruzadas
      const barcode = await this.dataSource
        .getRepository(ProductBarcode)
        .findOne({ where: { barcode: dto.codigo.trim() } });
      if (barcode) {
        item = items.find((i) => i.productId === barcode.productId);
        if (!item) {
          throw new BadRequestException(
            'El código pertenece a un producto que no está en este pedido',
          );
        }
      } else {
        const matcher = await this.buildMatcher(order.empresaId);
        const { producto } = matcher.match(dto.codigo);
        if (producto) {
          // I26: si el producto ya tiene código(s) de barras registrado(s),
          // solo esos códigos descuentan — cualquier otro se rechaza
          const registrados = await this.dataSource
            .getRepository(ProductBarcode)
            .findOne({ where: { productId: producto.id } });
          if (registrados) {
            throw new BadRequestException({
              statusCode: 400,
              code: 'CODIGO_NO_COINCIDE',
              message: `El producto ${producto.codigo} ya tiene código de barras registrado; lea el código de la etiqueta`,
            });
          }
        }
        if (!producto) {
          // HU-030: código no asociado → seleccionar el producto correspondiente
          throw new BadRequestException({
            statusCode: 400,
            code: 'CODIGO_NO_ASOCIADO',
            message:
              'El código leído no está asociado a ningún producto; seleccione el producto a que corresponde (modo INICIAL)',
          });
        }
        item = items.find((i) => i.productId === producto.id);
        if (!item) {
          throw new BadRequestException(
            `El producto ${producto.codigo} no está en este pedido`,
          );
        }
      }
    }

    // M12: durante un inventario EN_CONTEO el alistamiento queda en espera
    await this.inventories.assertNoBloqueo(item.productId, 'El alistamiento');

    // Bloqueo + conteo en una única transacción (UPDATE condicional atómico).
    // H-6: lock transaccional por línea de pedido — serializa los escaneos
    // concurrentes de la misma línea: el segundo espera al primero y ve su
    // commit, así el UPDATE condicional y el contador nunca divergen del
    // bloqueo aplicado (sin bloqueo huérfano ni incremento perdido).
    await this.dataSource.transaction(async (em) => {
      await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [item!.id]);
      await this.movements.apply(
        {
          productId: item!.productId,
          tipo: MovementType.BLOQUEO_ALISTAMIENTO,
          cantidadBloqueadaDelta: cantidad,
          docTipo: 'PEDIDO',
          docId: order.id,
          usuarioId: user.id,
        },
        em,
      );
      // TypeORM devuelve [rows, rowCount] en UPDATE … RETURNING
      const upd: [{ id: string }[], number] = await em.query(
        `UPDATE order_items SET cantidad_alistada = cantidad_alistada + $2
         WHERE id = $1 AND cantidad_alistada + $2 <= cantidad
         RETURNING id`,
        [item!.id, cantidad],
      );
      if (upd[1] === 0) {
        // Rollback de toda la transacción: también se revierte el bloqueo
        throw new BadRequestException(
          `Excedente: ${item!.codigo} ya tiene ${item!.cantidadAlistada}/${item!.cantidad} alistadas; no se pueden alistar ${cantidad} más`,
        );
      }
    });
    return this.getDetalle(id);
  }

  /** Operador confirma: pedido completo → ALISTADO (M08 paso 4). */
  async finalizarPicking(id: string, user: Usuario) {
    const order = await this.findOne(id);
    if (order.estado !== OrderStatus.ABIERTO) {
      throw new BadRequestException(
        `Solo se puede finalizar el alistamiento de un pedido Abierto (actual: ${order.estado})`,
      );
    }
    const items = await this.items.find({ where: { orderId: id } });
    const faltantes = items
      .filter((i) => i.cantidadAlistada < i.cantidad)
      .map((i) => ({ codigo: i.codigo, pendiente: i.cantidad - i.cantidadAlistada }));
    if (faltantes.length) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'ALISTAMIENTO_INCOMPLETO',
        message: 'El pedido tiene productos pendientes de alistar',
        faltantes,
      });
    }
    order.estado = OrderStatus.ALISTADO;
    order.alistadoPor = user.id;
    order.alistadoAt = new Date();
    await this.orders.save(order);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PEDIDO_ALISTADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { estado: OrderStatus.ALISTADO },
    });
    return this.getDetalle(id);
  }

  /** Producto no encontrado o cantidades inferiores → Pendiente_Corrección. */
  async reportar(id: string, user: Usuario) {
    const order = await this.findOne(id);
    if (order.estado !== OrderStatus.ABIERTO) {
      throw new BadRequestException(
        `Solo se puede reportar un pedido Abierto (actual: ${order.estado})`,
      );
    }
    order.estado = OrderStatus.PENDIENTE_CORRECCION;
    await this.orders.save(order);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PEDIDO_REPORTADO',
      tabla: TABLA,
      registroId: id,
      valorAnterior: { estado: OrderStatus.ABIERTO },
      valorNuevo: { estado: OrderStatus.PENDIENTE_CORRECCION },
      motivo: 'Producto no encontrado o cantidades inferiores durante el alistamiento',
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------
  // Corrección del creador (respuesta 4.2) → vuelve a ABIERTO
  // ---------------------------------------------------------------

  async correct(id: string, dto: CorrectOrderDto, user: Usuario) {
    const order = await this.findOne(id);
    if (order.estado !== OrderStatus.PENDIENTE_CORRECCION) {
      throw new BadRequestException(
        'Solo se puede corregir un pedido en estado Pendiente_Corrección',
      );
    }
    const esCreador = order.createdBy === user.id;
    const esGenerador = user.rol === Role.GENERADOR || user.rol === Role.ADMINISTRADOR;
    if (!esCreador && !esGenerador) {
      throw new ForbiddenException(
        'La corrección la realiza el usuario que creó el pedido (o el Generador)',
      );
    }

    const actuales = await this.items.find({ where: { orderId: id } });
    const resueltos = await this.resolverItems(
      order.empresaId,
      dto.items,
      actuales,
    );
    const anterior = actuales.map((i) => ({
      codigo: i.codigo,
      cantidad: i.cantidad,
      cantidadAlistada: i.cantidadAlistada,
    }));

    await this.dataSource.transaction(async (em) => {
      const nuevosPorProducto = new Map(resueltos.map((r) => [r.producto.id, r]));
      // Eliminar o ajustar líneas actuales
      for (const actual of actuales) {
        const nuevo = nuevosPorProducto.get(actual.productId);
        if (!nuevo) {
          // Producto eliminado: liberar lo bloqueado por este pedido
          if (actual.cantidadAlistada > 0) {
            await this.movements.apply(
              {
                productId: actual.productId,
                tipo: MovementType.LIBERACION_BLOQUEO,
                cantidadBloqueadaDelta: -actual.cantidadAlistada,
                docTipo: 'PEDIDO',
                docId: order.id,
                usuarioId: user.id,
              },
              em,
            );
          }
          await em.remove(actual);
        } else {
          if (nuevo.cantidad < actual.cantidadAlistada) {
            // Reducción por debajo de lo alistado: liberar la diferencia
            await this.movements.apply(
              {
                productId: actual.productId,
                tipo: MovementType.LIBERACION_BLOQUEO,
                cantidadBloqueadaDelta: -(actual.cantidadAlistada - nuevo.cantidad),
                docTipo: 'PEDIDO',
                docId: order.id,
                usuarioId: user.id,
              },
              em,
            );
            actual.cantidadAlistada = nuevo.cantidad;
          }
          actual.cantidad = nuevo.cantidad;
          actual.valorUnidad = nuevo.valorUnidad;
          actual.valorTotal = nuevo.cantidad * nuevo.valorUnidad;
          await em.save(actual);
          nuevosPorProducto.delete(actual.productId);
        }
      }
      // Agregar productos nuevos al pedido
      for (const r of nuevosPorProducto.values()) {
        await em.save(
          em.create(OrderItem, {
            orderId: order.id,
            productId: r.producto.id,
            codigo: r.producto.codigo,
            marca: r.producto.marca ?? null,
            descripcion: r.producto.descripcion,
            cantidad: r.cantidad,
            cantidadAlistada: 0,
            valorUnidad: r.valorUnidad,
            valorTotal: r.cantidad * r.valorUnidad,
          }),
        );
      }
      if (dto.comercialId !== undefined) order.comercialId = dto.comercialId;
      if (dto.ciudad !== undefined) order.ciudad = dto.ciudad?.trim() || null;
      if (dto.notas !== undefined) order.notas = dto.notas?.trim() || null;
      order.estado = OrderStatus.ABIERTO;
      await em.save(order);
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'PEDIDO_CORREGIDO',
          tabla: TABLA,
          registroId: id,
          valorAnterior: { estado: OrderStatus.PENDIENTE_CORRECCION, items: anterior },
          valorNuevo: {
            estado: OrderStatus.ABIERTO,
            items: resueltos.map((r) => ({ codigo: r.producto.codigo, cantidad: r.cantidad })),
          },
        },
        em,
      );
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------
  // Factura de venta y aprobación (HU-032)
  // ---------------------------------------------------------------

  async loadInvoice(id: string, ocrDocumentId: string, user: Usuario) {
    const order = await this.findOne(id);
    if (order.estado !== OrderStatus.ALISTADO) {
      throw new BadRequestException(
        `Solo se puede cargar factura a un pedido Alistado (actual: ${order.estado})`,
      );
    }
    const ocrDoc = await this.dataSource
      .getRepository(OcrDocument)
      .findOne({ where: { id: ocrDocumentId } });
    if (!ocrDoc) throw new NotFoundException('Documento OCR no encontrado');
    if (ocrDoc.tipoDocumento !== DocumentType.FACTURA_VENTA) {
      throw new BadRequestException('El documento OCR debe ser una factura de venta');
    }

    // Matchear las referencias de la factura contra productos de la empresa
    const matcher = await this.buildMatcher(order.empresaId);
    const d = ocrDoc.datosExtraidos as any;
    const itemsFactura: { codigo: string; cantidad: number }[] = [];
    for (const i of d.items ?? []) {
      const { producto } = matcher.match(String(i.referencia ?? ''));
      itemsFactura.push({
        codigo: producto ? producto.codigo : String(i.referencia ?? ''),
        cantidad: Number(i.cantidad) || 0,
      });
    }
    const itemsPedido = (await this.items.find({ where: { orderId: id } })).map(
      (i) => ({ codigo: i.codigo, cantidad: i.cantidad }),
    );
    const diferencias = compararFacturaConPedido(itemsPedido, itemsFactura);
    if (diferencias.length) {
      // M08: con diferencias muestra el error y no deja cambiar de estado
      throw new BadRequestException({
        statusCode: 400,
        code: 'FACTURA_CON_DIFERENCIAS',
        message:
          'La factura de venta tiene diferencias contra el pedido; no se puede aprobar',
        diferencias,
      });
    }

    order.numeroFactura = d.numeroFactura ?? null;
    order.facturaOcrDocumentId = ocrDocumentId;
    order.estado = OrderStatus.APROBADO;
    order.aprobadoPor = user.id;
    order.aprobadoAt = new Date();
    await this.orders.save(order);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PEDIDO_APROBADO',
      tabla: TABLA,
      registroId: id,
      valorAnterior: { estado: OrderStatus.ALISTADO },
      valorNuevo: { estado: OrderStatus.APROBADO, numeroFactura: order.numeroFactura },
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------
  // Cancelación (Generador): libera cantidades bloqueadas
  // ---------------------------------------------------------------

  async cancel(id: string, motivo: string | undefined, user: Usuario) {
    const order = await this.findOne(id);
    // B-2: la cancelación solo procede antes del empaque (whitelist acordada)
    const cancelables: OrderStatus[] = [
      OrderStatus.ABIERTO,
      OrderStatus.PENDIENTE_CORRECCION,
      OrderStatus.ALISTADO,
    ];
    if (!cancelables.includes(order.estado)) {
      throw new BadRequestException(
        `No se puede cancelar un pedido en estado ${order.estado}; solo Abierto, Pendiente corrección o Alistado`,
      );
    }
    const estadoAnterior = order.estado;
    const items = await this.items.find({ where: { orderId: id } });
    await this.dataSource.transaction(async (em) => {
      for (const item of items) {
        // C-2: solo se libera lo alistado NO despachado. Las unidades ya
        // despachadas liberaron su bloqueo en el cierre de caja; liberarlas
        // de nuevo corrompería cantidad_bloqueada (doble liberación).
        const pendienteLiberar = item.cantidadAlistada - item.cantidadDespachada;
        if (pendienteLiberar > 0) {
          await this.movements.apply(
            {
              productId: item.productId,
              tipo: MovementType.LIBERACION_BLOQUEO,
              cantidadBloqueadaDelta: -pendienteLiberar,
              docTipo: 'PEDIDO',
              docId: order.id,
              usuarioId: user.id,
            },
            em,
          );
        }
        // Se conserva cantidadAlistada = cantidadDespachada como registro
        // histórico de lo ya entregado (constraint: despachada <= alistada)
        if (item.cantidadAlistada !== item.cantidadDespachada) {
          item.cantidadAlistada = item.cantidadDespachada;
          await em.save(item);
        }
      }
      order.estado = OrderStatus.CANCELADO;
      order.motivoCancelacion = motivo?.trim() || null;
      order.canceladoAt = new Date();
      await em.save(order);
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'PEDIDO_CANCELADO',
          tabla: TABLA,
          registroId: id,
          valorAnterior: { estado: estadoAnterior },
          valorNuevo: { estado: OrderStatus.CANCELADO },
          motivo: motivo ?? null,
        },
        em,
      );
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------

  async findAll(empresaId?: string, estado?: OrderStatus, clienteId?: string, comercialId?: string) {
    const where: any = {};
    if (empresaId) where.empresaId = empresaId;
    if (estado) where.estado = estado;
    if (clienteId) where.clienteId = clienteId;
    // Tablero del comercial (M02): solo pedidos asociados a su comercial
    if (comercialId) where.comercialId = comercialId;
    const pedidos = await this.orders.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
    // I21: la tabla de pedidos necesita el nombre del cliente — el listado
    // no cargaba la relación y la columna salía siempre vacía ("—").
    const ids = [...new Set(pedidos.map((p) => p.clienteId))];
    const clientes = ids.length
      ? await this.dataSource.getRepository(Client).find({
          where: ids.map((id) => ({ id })),
        })
      : [];
    const porId = new Map(clientes.map((c) => [c.id, c]));
    return pedidos.map((p) => {
      const cliente = porId.get(p.clienteId);
      return {
        ...p,
        cliente: cliente
          ? { id: cliente.id, nombre: cliente.nombre, identificacion: cliente.identificacion }
          : null,
      };
    });
  }

  async getDetalle(id: string, user?: Usuario) {
    const order = await this.findOne(id);
    // Tablero del comercial (M02): solo pedidos de su comercial
    if (user?.rol === 'COMERCIAL' && (user as any).comercialId
        && order.comercialId !== (user as any).comercialId) {
      throw new NotFoundException('Pedido no encontrado');
    }
    const items = await this.items.find({
      where: { orderId: id },
      order: { createdAt: 'ASC' },
    });
    const itemsConPendiente = items.map((i) => ({
      ...i,
      pendiente: i.cantidad - i.cantidadAlistada,
    }));
    const valorTotal = items.reduce((acc, i) => acc + Number(i.valorTotal), 0);
    const cliente = await this.dataSource
      .getRepository('clients')
      .findOne({ where: { id: order.clienteId } }) as any;
    // I19: trazabilidad de usuario en cada hito del pedido (nombres, no UUIDs)
    const usuarios = await this.resolverUsuarios([
      order.createdBy,
      order.alistadoPor,
      order.aprobadoPor,
    ]);
    return {
      ...order,
      items: itemsConPendiente,
      valorTotal,
      cliente: cliente
        ? {
            id: cliente.id,
            nombre: cliente.nombre,
            identificacion: cliente.identificacion,
            direccion: cliente.direccion,
            telefonos: cliente.telefonos,
            ciudad: cliente.ciudad,
          }
        : null,
      trazabilidad: {
        creadoPor: usuarios.get(order.createdBy) ?? null,
        alistadoPor: usuarios.get(order.alistadoPor) ?? null,
        aprobadoPor: usuarios.get(order.aprobadoPor) ?? null,
      },
    };
  }

  /** I19: UUID de usuario → { id, nombre, username } en una sola consulta. */
  private async resolverUsuarios(
    ids: (string | null | undefined)[],
  ): Promise<Map<string, { id: string; nombre: string; username: string }>> {
    const unicos = [...new Set(ids.filter((x): x is string => !!x))];
    const mapa = new Map<string, { id: string; nombre: string; username: string }>();
    if (!unicos.length) return mapa;
    const usuarios = await this.dataSource.getRepository(User).find({
      where: unicos.map((id) => ({ id })),
    });
    for (const u of usuarios) {
      mapa.set(u.id, { id: u.id, nombre: u.nombre, username: u.username });
    }
    return mapa;
  }

  private async findOne(id: string): Promise<Order> {
    const order = await this.orders.findOne({ where: { id } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

  /** M08: Comercial automático para usuarios Comercial; manual para otros. */
  private resolveComercial(dto: CreateOrderDto, user: Usuario): string | null {
    if (user.rol === Role.COMERCIAL) {
      if (!user.comercialId) {
        throw new BadRequestException(
          'El usuario Comercial no tiene un comercial asociado',
        );
      }
      return user.comercialId;
    }
    if (!dto.comercialId) {
      throw new BadRequestException(
        'Debe indicar el comercial del pedido',
      );
    }
    return dto.comercialId;
  }

  /**
   * Resuelve referencias a productos de la empresa y valida disponibilidad
   * (cantidad − bloqueada, excluyendo lo ya alistado por este mismo pedido
   * en correcciones).
   */
  private async resolverItems(
    empresaId: string,
    itemsDto: OrderItemDto[],
    actuales: OrderItem[] = [],
  ): Promise<ItemResuelto[]> {
    const matcher = await this.buildMatcher(empresaId);
    const alistadaPropia = new Map(actuales.map((i) => [i.productId, i.cantidadAlistada]));
    const agregados = new Map<string, number>();
    const resueltos: ItemResuelto[] = [];
    for (const it of itemsDto) {
      const { producto } = matcher.match(it.referencia);
      if (!producto) {
        throw new BadRequestException(
          `Producto no encontrado en la empresa para la referencia '${it.referencia}'`,
        );
      }
      agregados.set(producto.id, (agregados.get(producto.id) ?? 0) + it.cantidad);
      resueltos.push({
        producto,
        cantidad: it.cantidad,
        valorUnidad: it.valorUnidad ?? Number(producto.precio),
      });
    }
    // Disponibilidad por producto agregado (M08 paso 2: cantidad − bloqueada)
    for (const [productId, total] of agregados) {
      const r = resueltos.find((x) => x.producto.id === productId)!;
      const disponible =
        r.producto.cantidad -
        (r.producto.cantidadBloqueada - (alistadaPropia.get(productId) ?? 0));
      if (total > disponible) {
        throw new BadRequestException(
          `Sin disponibilidad para ${r.producto.codigo}: pedida ${total}, disponible ${disponible} ` +
            `(cantidad ${r.producto.cantidad} − bloqueada ${r.producto.cantidadBloqueada})`,
        );
      }
    }
    return resueltos;
  }

  /** Consecutivo SIGLAS-#### independiente por empresa (UPSERT atómico). */
  private async siguienteConsecutivo(em: EntityManager, empresaId: string): Promise<string> {
    const empresa = await em
      .getRepository('companies')
      .findOne({ where: { id: empresaId } }) as any;
    if (!empresa) throw new NotFoundException('Empresa no encontrada');
    const rows: { ultimo: number }[] = await em.query(
      `INSERT INTO order_counters (empresa_id, ultimo) VALUES ($1, 1)
       ON CONFLICT (empresa_id) DO UPDATE SET ultimo = order_counters.ultimo + 1
       RETURNING ultimo`,
      [empresaId],
    );
    return `${empresa.siglas}-${String(rows[0].ultimo).padStart(4, '0')}`;
  }

  private async buildMatcher(empresaId: string): Promise<InboundMatcher> {
    const productos = await this.dataSource.getRepository(Product).find({
      where: { empresaId },
    });
    const ids = new Set(productos.map((p) => p.id));
    const barcodes = await this.dataSource.getRepository(ProductBarcode).find();
    const map = new Map<string, string>();
    for (const b of barcodes) {
      if (ids.has(b.productId)) map.set(b.barcode.trim().toUpperCase(), b.productId);
    }
    return new InboundMatcher(productos, map);
  }
}
