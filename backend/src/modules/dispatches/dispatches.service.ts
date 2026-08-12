import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import * as QRCode from 'qrcode';
import { Dispatch, DispatchStatus, TransportType } from './entities/dispatch.entity';
import { DispatchOrder } from './entities/dispatch-order.entity';
import { Box, BoxStatus } from './entities/box.entity';
import { BoxItem } from './entities/box-item.entity';
import { Order, OrderStatus } from '../orders/entities/order.entity';
import { OrderItem } from '../orders/entities/order-item.entity';
import { Carrier } from '../carriers/entities/carrier.entity';
import { CarrierType } from '../../common/enums/carrier-type.enum';
import { Product } from '../products/entities/product.entity';
import { ProductBarcode } from '../products/entities/product-barcode.entity';
import { InboundMatcher } from '../inbound/inbound-matcher';
import { calcularPendiente, formatBoxId, formatNumeroDespacho } from './dispatch-helpers';
import { MovementsService } from '../movements/movements.service';
import { MovementType } from '../../common/enums/movement-type.enum';
import { AuditService } from '../audit/audit.service';
import { InventoriesService } from '../inventories/inventories.service';
import {
  ApproveParcialDto,
  AssociateOrdersDto,
  CancelDispatchDto,
  CreateDispatchDto,
  ReturnDispatchDto,
  ScanBoxDto,
  TransportDto,
} from './dto/dispatch.dto';

type Usuario = { id: string; username: string; rol?: string };

const TABLA = 'Despachos';

/** Estados en los que el despacho todavía no sale de bodega. */
const ESTADOS_ACTIVOS: DispatchStatus[] = [
  DispatchStatus.CREADO,
  DispatchStatus.ABIERTO,
  DispatchStatus.PENDIENTE_CORRECCION,
  DispatchStatus.PARCIAL,
];

export interface PendienteItem {
  orderItemId: string;
  orderId: string;
  numeroPedido: string;
  empresaId: string;
  productId: string;
  codigo: string;
  descripcion: string;
  cantidadAlistada: number;
  cantidadDespachada: number;
  /** Unidades ya contadas en cajas ABIERTAS de este despacho. */
  enCajasAbiertas: number;
  /** Lo que falta por empacar: alistada − despachada − enCajasAbiertas. */
  pendiente: number;
}

/**
 * M09 (EP-08): despachos y cajas. Reglas clave:
 * - Consolida pedidos APROBADOS del mismo cliente, aunque sean de varias
 *   empresas (HU-034/D-03: despacho global). La empresa principal (la del
 *   primer pedido) define el consecutivo SIGLAS-#### (serie por empresa).
 * - El escaneo a caja SOLO acumula conteo; Cantidad y Cantidad bloqueada se
 *   descuentan AL CERRAR LA CAJA en una única transacción por producto
 *   (DESPACHO_CIERRE_CAJA, regla transversal).
 * - El QR de la etiqueta contiene únicamente el box_id (CJA-###### global).
 * - Parcial requiere aprobación del Generador con motivo (HU-041) y se
 *   completa con un despacho adicional (D-06/HU-042).
 */
@Injectable()
export class DispatchesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly movements: MovementsService,
    private readonly audit: AuditService,
    private readonly inventories: InventoriesService,
  ) {}

  // ------------------------------------------------------------------
  // HU-033: crear despacho (Generador)
  // ------------------------------------------------------------------
  async create(dto: CreateDispatchDto, user: Usuario) {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    await this.assertOrderAsociable(order);

    const dispatchId = await this.dataSource.transaction(async (em) => {
      // B-1: despacho GLOBAL — consecutivo compartido por todas las empresas;
      // empresa_id queda null (la membresía por empresa vive en dispatch_orders)
      const numero = await this.siguienteConsecutivo(em);
      const dispatch = await em.save(
        em.create(Dispatch, {
          empresaId: null,
          numero,
          clienteId: order.clienteId,
          estado: DispatchStatus.CREADO,
          createdBy: user.id,
        }),
      );
      await em.save(
        em.create(DispatchOrder, {
          dispatchId: dispatch.id,
          orderId: order.id,
          empresaId: order.empresaId,
        }),
      );
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'DESPACHO_CREADO',
          tabla: TABLA,
          registroId: dispatch.id,
          valorNuevo: { numero, clienteId: order.clienteId, pedido: order.numero },
        },
        em,
      );
      return dispatch.id;
    });
    return this.get(dispatchId);
  }

  // ------------------------------------------------------------------
  // HU-034: asociar pedidos del mismo cliente (CREADO o PENDIENTE_CORRECCION)
  // ------------------------------------------------------------------
  async associateOrders(id: string, dto: AssociateOrdersDto, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    this.assertEditable(dispatch);
    const ordersRepo = this.dataSource.getRepository(Order);
    const linksRepo = this.dataSource.getRepository(DispatchOrder);

    // Validaciones ANTES de abrir la transacción (usan el pool, no `em`)
    const porAsociar: Order[] = [];
    for (const orderId of dto.orderIds) {
      const order = await ordersRepo.findOne({ where: { id: orderId } });
      if (!order) throw new NotFoundException(`Pedido ${orderId} no encontrado`);
      if (order.clienteId !== dispatch.clienteId) {
        // M-3: conflicto de regla de negocio → 409 (no 400)
        throw new ConflictException(
          `El pedido ${order.numero} es de otro cliente; el despacho consolida pedidos del mismo cliente (HU-034)`,
        );
      }
      const ya = await linksRepo.findOne({ where: { dispatchId: id, orderId } });
      if (ya) continue;
      await this.assertOrderAsociable(order);
      porAsociar.push(order);
    }

    await this.dataSource.transaction(async (em) => {
      for (const order of porAsociar) {
        await em.save(
          em.create(DispatchOrder, { dispatchId: id, orderId: order.id, empresaId: order.empresaId }),
        );
      }
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'DESPACHO_PEDIDOS_ASOCIADOS',
          tabla: TABLA,
          registroId: id,
          valorNuevo: { pedidos: porAsociar.map((o) => o.numero) },
        },
        em,
      );
    });
    return this.get(id);
  }

  /** Retirar un pedido del despacho (ciclo de corrección, M09 paso 2). */
  async removeOrder(id: string, orderId: string, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    this.assertEditable(dispatch);
    const repo = this.dataSource.getRepository(DispatchOrder);
    const link = await repo.findOne({ where: { dispatchId: id, orderId } });
    if (!link) throw new NotFoundException('El pedido no está asociado a este despacho');
    const total = await repo.count({ where: { dispatchId: id } });
    if (total <= 1) {
      throw new BadRequestException('El despacho debe conservar al menos un pedido');
    }
    await repo.remove(link);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'DESPACHO_PEDIDO_RETIRADO',
      tabla: TABLA,
      registroId: id,
      valorAnterior: { orderId },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // M09 paso 2: aprobar (CREADO/PENDIENTE_CORRECCION → ABIERTO)
  // ------------------------------------------------------------------
  async aprobar(id: string, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    if (
      dispatch.estado !== DispatchStatus.CREADO &&
      dispatch.estado !== DispatchStatus.PENDIENTE_CORRECCION
    ) {
      throw new BadRequestException(`No se puede aprobar un despacho en estado ${dispatch.estado}`);
    }
    const pedidos = await this.dataSource
      .getRepository(DispatchOrder)
      .count({ where: { dispatchId: id } });
    if (pedidos === 0) throw new BadRequestException('El despacho no tiene pedidos asociados');
    dispatch.estado = DispatchStatus.ABIERTO;
    dispatch.aprobadoPor = user.id;
    await this.dataSource.getRepository(Dispatch).save(dispatch);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'DESPACHO_APROBADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { estado: DispatchStatus.ABIERTO },
    });
    return this.get(id);
  }

  /** Operador devuelve el despacho al Generador por error de productos. */
  async devolver(id: string, dto: ReturnDispatchDto, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    if (dispatch.estado !== DispatchStatus.ABIERTO) {
      throw new BadRequestException('Solo se puede devolver un despacho ABIERTO');
    }
    const cerradas = await this.dataSource
      .getRepository(Box)
      .count({ where: { dispatchId: id, estado: BoxStatus.CERRADA } });
    if (cerradas > 0) {
      throw new BadRequestException(
        'No se puede devolver: ya hay cajas cerradas con existencias descontadas',
      );
    }
    dispatch.estado = DispatchStatus.PENDIENTE_CORRECCION;
    await this.dataSource.getRepository(Dispatch).save(dispatch);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'DESPACHO_DEVUELTO',
      tabla: TABLA,
      registroId: id,
      motivo: dto.motivo,
      valorNuevo: { estado: DispatchStatus.PENDIENTE_CORRECCION },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // Consultas
  // ------------------------------------------------------------------
  /**
   * HU-054: consulta de despachos con filtros por cliente, empresa, fecha,
   * documento (factura), caja y guía. `comercialId` (tablero del comercial,
   * M02) limita a despachos que contienen pedidos de ese comercial.
   */
  async list(filters: {
    estado?: DispatchStatus;
    clienteId?: string;
    empresaId?: string;
    fechaDesde?: string;
    fechaHasta?: string;
    documento?: string;
    boxId?: string;
    guia?: string;
    comercialId?: string;
  }) {
    const qb = this.dataSource
      .getRepository(Dispatch)
      .createQueryBuilder('d')
      .orderBy('d.createdAt', 'DESC');
    if (filters.estado) qb.andWhere('d.estado = :estado', { estado: filters.estado });
    if (filters.clienteId) qb.andWhere('d.clienteId = :clienteId', { clienteId: filters.clienteId });
    if (filters.empresaId) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM dispatch_orders do2 WHERE do2.dispatch_id = d.id AND do2.empresa_id = :empresaId)`,
        { empresaId: filters.empresaId },
      );
    }
    if (filters.fechaDesde) {
      qb.andWhere('d.createdAt >= :desde', { desde: new Date(filters.fechaDesde) });
    }
    if (filters.fechaHasta) {
      const hasta = new Date(filters.fechaHasta);
      hasta.setHours(23, 59, 59, 999);
      qb.andWhere('d.createdAt <= :hasta', { hasta });
    }
    if (filters.documento?.trim()) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM dispatch_orders do3
           JOIN orders o3 ON o3.id = do3.order_id
           WHERE do3.dispatch_id = d.id AND o3.numero_factura = :documento
         )`,
        { documento: filters.documento.trim() },
      );
    }
    if (filters.boxId?.trim()) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM boxes b WHERE b.dispatch_id = d.id AND b.box_id = :boxId)`,
        { boxId: filters.boxId.trim().toUpperCase() },
      );
    }
    if (filters.guia?.trim()) {
      qb.andWhere('d.guia = :guia', { guia: filters.guia.trim() });
    }
    if (filters.comercialId) {
      qb.andWhere(
        `EXISTS (
           SELECT 1 FROM dispatch_orders do4
           JOIN orders o4 ON o4.id = do4.order_id
           WHERE do4.dispatch_id = d.id AND o4.comercial_id = :comercialId
         )`,
        { comercialId: filters.comercialId },
      );
    }
    const rows = await qb.getMany();
    // Resumen con conteos de pedidos y cajas
    const out: any[] = [];
    for (const d of rows) {
      const pedidos = await this.dataSource
        .getRepository(DispatchOrder)
        .count({ where: { dispatchId: d.id } });
      const cajas = await this.dataSource
        .getRepository(Box)
        .count({ where: { dispatchId: d.id } });
      out.push({ ...d, totalPedidos: pedidos, totalCajas: cajas });
    }
    return out;
  }

  async get(id: string, user?: Usuario) {
    const dispatch = await this.findDispatch(id);
    const links = await this.dataSource
      .getRepository(DispatchOrder)
      .find({ where: { dispatchId: id }, order: { createdAt: 'ASC' } });
    // Tablero del comercial (M02): solo despachos con pedidos de su comercial
    if (user?.rol === 'COMERCIAL' && (user as any).comercialId) {
      const propio = await this.dataSource.query(
        `SELECT 1 FROM dispatch_orders do2
         JOIN orders o ON o.id = do2.order_id
         WHERE do2.dispatch_id = $1 AND o.comercial_id = $2 LIMIT 1`,
        [id, (user as any).comercialId],
      );
      if (propio.length === 0) throw new NotFoundException('Despacho no encontrado');
    }
    const ordersRepo = this.dataSource.getRepository(Order);
    const itemsRepo = this.dataSource.getRepository(OrderItem);
    const pedidos: any[] = [];
    for (const l of links) {
      const o = await ordersRepo.findOne({ where: { id: l.orderId } });
      const items = await itemsRepo.find({ where: { orderId: l.orderId } });
      pedidos.push({
        ...o,
        empresaPedido: l.empresaId,
        items: items.map((i) => ({
          ...i,
          pendienteDespachar: i.cantidadAlistada - i.cantidadDespachada,
        })),
      });
    }
    const boxes = await this.dataSource
      .getRepository(Box)
      .find({ where: { dispatchId: id }, order: { numeroEnDespacho: 'ASC' } });
    const boxItemsRepo = this.dataSource.getRepository(BoxItem);
    const cajas: any[] = [];
    for (const b of boxes) {
      const items = await boxItemsRepo.find({ where: { boxId: b.id } });
      cajas.push({ ...b, items });
    }
    const pendientes = await this.pendientes(id);
    const cliente = await this.dataSource
      .getRepository('clients')
      .findOne({ where: { id: dispatch.clienteId } });
    return { ...dispatch, cliente, pedidos, cajas, pendientes };
  }

  /** HU-062: consulta de despacho por su número (API externa y consultas). */
  async getByNumero(numero: string) {
    const d = await this.dataSource
      .getRepository(Dispatch)
      .findOne({ where: { numero: numero.trim().toUpperCase() } });
    if (!d) throw new NotFoundException(`Despacho ${numero} no encontrado`);
    return this.get(d.id);
  }

  /**
   * M10/HU-053: consulta de caja por su box_id visible (contenido del QR).
   * Muestra productos, cantidades, cliente, empresas, documentos y fecha.
   */
  async consultaCaja(boxId: string) {
    const box = await this.dataSource
      .getRepository(Box)
      .findOne({ where: { boxId: boxId.trim().toUpperCase() } });
    if (!box) throw new NotFoundException(`Caja ${boxId} no encontrada`);
    const items = await this.dataSource
      .getRepository(BoxItem)
      .find({ where: { boxId: box.id } });
    const dispatch = await this.findDispatch(box.dispatchId);
    const cliente = (await this.dataSource
      .getRepository('clients')
      .findOne({ where: { id: dispatch.clienteId } })) as any;
    const companies = await this.dataSource.getRepository('companies').find();

    const detalle: any[] = [];
    const documentos = new Set<string>();
    const empresas = new Map<string, string>();
    for (const it of items) {
      const oi = await this.dataSource
        .getRepository(OrderItem)
        .findOne({ where: { id: it.orderItemId } });
      const order = oi
        ? await this.dataSource.getRepository(Order).findOne({ where: { id: oi.orderId } })
        : null;
      if (order?.numeroFactura) documentos.add(order.numeroFactura);
      const empresa = companies.find((c: any) => c.id === it.empresaId) as any;
      if (empresa) empresas.set(empresa.id, empresa.nombre);
      detalle.push({
        ...it,
        descripcion: oi?.descripcion ?? null,
        pedido: order?.numero ?? null,
        numeroFactura: order?.numeroFactura ?? null,
        empresa: empresa?.nombre ?? null,
      });
    }
    return {
      boxId: box.boxId,
      estado: box.estado,
      numeroEnDespacho: box.numeroEnDespacho,
      fecha: box.cerradaAt ?? box.createdAt,
      despacho: { id: dispatch.id, numero: dispatch.numero, estado: dispatch.estado },
      cliente: cliente ? { id: cliente.id, nombre: cliente.nombre } : null,
      empresas: [...empresas.values()],
      documentos: [...documentos],
      items: detalle,
    };
  }

  // ------------------------------------------------------------------
  // HU-035/037: crear caja (CJA-###### global; ordinal dentro del despacho)
  // ------------------------------------------------------------------
  async createBox(dispatchId: string, user: Usuario) {
    const dispatch = await this.findDispatch(dispatchId);
    if (dispatch.estado !== DispatchStatus.ABIERTO) {
      throw new BadRequestException('Solo se empacan cajas en un despacho ABIERTO');
    }
    return this.dataSource.transaction(async (em) => {
      const boxId = await this.siguienteBoxId(em);
      const count = await em.count(Box, { where: { dispatchId } });
      const box = await em.save(
        em.create(Box, {
          boxId,
          dispatchId,
          numeroEnDespacho: count + 1,
          estado: BoxStatus.ABIERTA,
          createdBy: user.id,
        }),
      );
      return box;
    });
  }

  // ------------------------------------------------------------------
  // HU-036: escaneo a caja — SOLO acumula conteo (regla transversal)
  // ------------------------------------------------------------------
  async scanToBox(dispatchId: string, boxPk: string, dto: ScanBoxDto, user: Usuario) {
    const dispatch = await this.findDispatch(dispatchId);
    if (dispatch.estado !== DispatchStatus.ABIERTO) {
      throw new BadRequestException('El despacho no está ABIERTO');
    }
    const box = await this.findBox(dispatchId, boxPk);
    if (box.estado !== BoxStatus.ABIERTA) throw new BadRequestException('La caja está CERRADA');
    const cantidad = dto.cantidad ?? 1;

    // El código puede ser de cualquiera de las empresas del despacho (HU-034)
    const links = await this.dataSource
      .getRepository(DispatchOrder)
      .find({ where: { dispatchId } });
    let producto: Product | null = null;
    for (const empresaId of [...new Set(links.map((l) => l.empresaId))]) {
      const matcher = await this.buildMatcher(empresaId);
      const { producto: p } = matcher.match(dto.codigo);
      if (p) {
        producto = p;
        break;
      }
    }
    if (!producto) {
      throw new BadRequestException(
        `El código ${dto.codigo} no corresponde a ningún producto de los pedidos del despacho`,
      );
    }

    // Línea de pedido candidata con pendiente por empacar
    const pendientes = await this.pendientes(dispatchId);
    const candidato = pendientes
      .filter((p) => p.productId === producto!.id)
      .sort((a, b) => b.pendiente - a.pendiente)[0];
    if (!candidato) {
      throw new BadRequestException(
        `El producto ${producto.codigo} no tiene unidades pendientes por empacar en este despacho`,
      );
    }
    // M12: durante un inventario EN_CONTEO el despacho del producto se bloquea
    await this.inventories.assertNoBloqueo(candidato.productId, 'El despacho');

    if (cantidad > candidato.pendiente) {
      throw new BadRequestException(
        `Excedente: ${producto.codigo} tiene ${candidato.pendiente} unidades pendientes por empacar y se intentan ${cantidad}`,
      );
    }

    const repo = this.dataSource.getRepository(BoxItem);
    let item = await repo.findOne({ where: { boxId: box.id, orderItemId: candidato.orderItemId } });
    if (item) {
      item.cantidad += cantidad;
      await repo.save(item);
    } else {
      const order = await this.dataSource
        .getRepository(Order)
        .findOne({ where: { id: candidato.orderId } });
      item = await repo.save(
        repo.create({
          boxId: box.id,
          orderItemId: candidato.orderItemId,
          productId: producto.id,
          empresaId: order!.empresaId,
          codigo: producto.codigo,
          cantidad,
        }),
      );
    }
    return { box: box.boxId, item, pendienteRestante: candidato.pendiente - cantidad };
  }

  // ------------------------------------------------------------------
  // HU-037: cerrar caja — descuento de Cantidad y bloqueada en UNA
  // transacción por producto (regla transversal) + QR con solo box_id
  // ------------------------------------------------------------------
  async closeBox(dispatchId: string, boxPk: string, user: Usuario) {
    const dispatch = await this.findDispatch(dispatchId);
    if (dispatch.estado !== DispatchStatus.ABIERTO) {
      throw new BadRequestException('El despacho no está ABIERTO');
    }
    const box = await this.findBox(dispatchId, boxPk);
    if (box.estado === BoxStatus.CERRADA) throw new BadRequestException('La caja ya está CERRADA');
    const items = await this.dataSource.getRepository(BoxItem).find({ where: { boxId: box.id } });
    if (items.length === 0) throw new BadRequestException('No se puede cerrar una caja vacía');

    await this.dataSource.transaction(async (em) => {
      // C-1: cierre seguro ante concurrencia — transición atómica de estado.
      // Dos POST concurrentes: solo uno actualiza la fila; el otro aborta
      // ANTES de aplicar movimientos (sin doble descuento de stock).
      const cierre: [{ id: string }[], number] = await em.query(
        `UPDATE boxes SET estado = 'CERRADA', cerrada_at = now()
         WHERE id = $1 AND estado = 'ABIERTA' RETURNING id`,
        [box.id],
      );
      if (cierre[1] === 0) {
        throw new ConflictException('La caja ya fue cerrada por otra operación concurrente');
      }
      for (const it of items) {
        // Validación de excedente con lock de la línea (evita doble conteo
        // de cantidad_despachada en cierres concurrentes de distintas cajas)
        const lockOi: { id: string }[] = await em.query(
          `SELECT id FROM order_items WHERE id = $1 FOR UPDATE`,
          [it.orderItemId],
        );
        if (!Array.isArray(lockOi) || lockOi.length === 0) {
          throw new NotFoundException('Línea de pedido no encontrada');
        }
        // Validación de excedente contra lo alistado pendiente (HU-036)
        const oi = await em.findOne(OrderItem, { where: { id: it.orderItemId } });
        if (!oi) throw new NotFoundException('Línea de pedido no encontrada');
        if (oi.cantidadDespachada + it.cantidad > oi.cantidadAlistada) {
          throw new BadRequestException(
            `Excedente en ${it.codigo}: alistado ${oi.cantidadAlistada}, ya despachado ${oi.cantidadDespachada}, en esta caja ${it.cantidad}`,
          );
        }
        // Descuento atómico de Cantidad y Cantidad bloqueada (regla transversal)
        await this.movements.apply(
          {
            productId: it.productId,
            tipo: MovementType.DESPACHO_CIERRE_CAJA,
            cantidadDelta: -it.cantidad,
            cantidadBloqueadaDelta: -it.cantidad,
            docTipo: 'DESPACHO',
            docId: dispatch.id,
            usuarioId: user.id,
          },
          em,
        );
        await em.query(
          `UPDATE order_items SET cantidad_despachada = cantidad_despachada + $2 WHERE id = $1`,
          [it.orderItemId, it.cantidad],
        );
      }
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'DESPACHO_CAJA_CERRADA',
          tabla: TABLA,
          registroId: dispatch.id,
          valorNuevo: {
            caja: box.boxId,
            items: items.map((i) => ({ codigo: i.codigo, cantidad: i.cantidad })),
          },
        },
        em,
      );
    });
    return this.etiqueta(dispatchId, box.id);
  }

  /** HU-038: etiqueta con QR que contiene únicamente el box_id (reimpresión). */
  async etiqueta(dispatchId: string, boxPk: string) {
    const box = await this.findBox(dispatchId, boxPk);
    const dispatch = await this.findDispatch(dispatchId);
    const qrDataUrl = await QRCode.toDataURL(box.boxId, { width: 220, margin: 1 });
    return {
      boxId: box.boxId,
      numeroEnDespacho: box.numeroEnDespacho,
      estado: box.estado,
      despachoNumero: dispatch.numero,
      /** QR 50x30 mm en la etiqueta impresa; contiene SOLO el box_id. */
      qrDataUrl,
    };
  }

  // ------------------------------------------------------------------
  // M09 paso 4: finalizar empaque → completo o PARCIAL (HU-041)
  // ------------------------------------------------------------------
  async finalizarEmpaque(id: string, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    if (dispatch.estado !== DispatchStatus.ABIERTO) {
      throw new BadRequestException('El despacho no está ABIERTO');
    }
    const boxes = await this.dataSource.getRepository(Box).find({ where: { dispatchId: id } });
    if (boxes.length === 0) throw new BadRequestException('El despacho no tiene cajas');
    const abiertas = boxes.filter((b) => b.estado === BoxStatus.ABIERTA);
    if (abiertas.length > 0) {
      throw new BadRequestException(
        `Hay ${abiertas.length} caja(s) ABIERTA(s); ciérrelas antes de finalizar el empaque`,
      );
    }
    const pendientes = (await this.pendientes(id)).filter((p) => p.pendiente > 0);
    dispatch.empaqueFinalizado = true;
    if (pendientes.length > 0) {
      dispatch.estado = DispatchStatus.PARCIAL;
    }
    await this.dataSource.getRepository(Dispatch).save(dispatch);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'DESPACHO_EMPAQUE_FINALIZADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: {
        estado: dispatch.estado,
        pendientes: pendientes.map((p) => ({ codigo: p.codigo, pendiente: p.pendiente })),
      },
    });
    return this.get(id);
  }

  /** HU-041: el Generador aprueba el despacho parcial con motivo obligatorio. */
  async aprobarParcial(id: string, dto: ApproveParcialDto, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    if (dispatch.estado !== DispatchStatus.PARCIAL) {
      throw new BadRequestException('El despacho no está en estado PARCIAL');
    }
    dispatch.parcialMotivo = dto.motivo;
    dispatch.parcialAprobadoPor = user.id;
    dispatch.parcialAprobadoAt = new Date();
    await this.dataSource.getRepository(Dispatch).save(dispatch);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'DESPACHO_PARCIAL_APROBADO',
      tabla: TABLA,
      registroId: id,
      motivo: dto.motivo,
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // HU-039/040: registro de transporte → DESPACHADO
  // ------------------------------------------------------------------
  async registerTransport(id: string, dto: TransportDto, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    if (!dispatch.empaqueFinalizado) {
      throw new BadRequestException('Primero debe finalizar el empaque');
    }
    if (dispatch.estado === DispatchStatus.PARCIAL && !dispatch.parcialAprobadoAt) {
      throw new BadRequestException(
        'El despacho parcial requiere aprobación del Generador con motivo (HU-041)',
      );
    }
    if (
      dispatch.estado !== DispatchStatus.ABIERTO &&
      dispatch.estado !== DispatchStatus.PARCIAL
    ) {
      throw new BadRequestException(`No se puede registrar transporte en estado ${dispatch.estado}`);
    }

    let carrier: Carrier | null = null;
    if (dto.tipo === TransportType.EXTERNA) {
      if (!dto.carrierId) throw new BadRequestException('Seleccione la transportadora');
      if (!dto.guia?.trim()) throw new BadRequestException('La guía es obligatoria');
      carrier = await this.dataSource
        .getRepository(Carrier)
        .findOne({ where: { id: dto.carrierId } });
      if (!carrier || !carrier.activo) throw new NotFoundException('Transportadora no encontrada o inactiva');
      if (carrier.tipo !== CarrierType.EXTERNA) {
        throw new BadRequestException('La transportadora seleccionada no es de tipo EXTERNA');
      }
    } else {
      if (!dto.nombreTransporte?.trim()) {
        throw new BadRequestException('Indique el nombre del transporte interno');
      }
      if (dto.carrierId) {
        carrier = await this.dataSource
          .getRepository(Carrier)
          .findOne({ where: { id: dto.carrierId } });
        if (!carrier || !carrier.activo) {
          throw new NotFoundException('Transportadora no encontrada o inactiva');
        }
      }
    }

    dispatch.tipoTransporte = dto.tipo;
    dispatch.carrierId = carrier?.id ?? null;
    dispatch.guia = dto.guia?.trim() || null;
    dispatch.nombreTransporte =
      dto.tipo === TransportType.EXTERNA ? carrier!.nombre : dto.nombreTransporte!.trim();
    dispatch.fechaSalida = new Date();
    dispatch.estado = DispatchStatus.DESPACHADO;
    dispatch.despachadoAt = new Date();
    await this.dataSource.getRepository(Dispatch).save(dispatch);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'DESPACHO_TRANSPORTE_REGISTRADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: {
        tipo: dto.tipo,
        transporte: dispatch.nombreTransporte,
        guia: dispatch.guia,
        estado: DispatchStatus.DESPACHADO,
      },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // D-06/HU-042: despacho adicional para completar un parcial
  // ------------------------------------------------------------------
  async completarParcial(id: string, user: Usuario) {
    const origen = await this.findDispatch(id);
    if (origen.estado !== DispatchStatus.DESPACHADO) {
      throw new BadRequestException('El despacho origen debe estar DESPACHADO');
    }
    const pendientes = (await this.pendientes(id)).filter((p) => p.pendiente > 0);
    if (pendientes.length === 0) {
      throw new BadRequestException('El despacho no tiene unidades pendientes por completar');
    }
    const adicionalId = await this.dataSource.transaction(async (em) => {
      // B-1: el despacho adicional también es global (serie compartida)
      const numero = await this.siguienteConsecutivo(em);
      const adicional = await em.save(
        em.create(Dispatch, {
          empresaId: null,
          numero,
          clienteId: origen.clienteId,
          estado: DispatchStatus.CREADO,
          despachoOrigenId: origen.id,
          createdBy: user.id,
        }),
      );
      const orderIds = [...new Set(pendientes.map((p) => p.orderId))];
      const links = await em.find(DispatchOrder, { where: { dispatchId: id } });
      for (const orderId of orderIds) {
        const link = links.find((l) => l.orderId === orderId);
        await em.save(
          em.create(DispatchOrder, {
            dispatchId: adicional.id,
            orderId,
            empresaId: link!.empresaId,
          }),
        );
      }
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'DESPACHO_ADICIONAL_CREADO',
          tabla: TABLA,
          registroId: adicional.id,
          valorNuevo: { numero, despachoOrigen: origen.numero, pedidos: orderIds.length },
        },
        em,
      );
      return adicional.id;
    });
    return this.get(adicionalId);
  }

  // ------------------------------------------------------------------
  // Cancelación: revierte los movimientos de las cajas cerradas
  // ------------------------------------------------------------------
  async cancel(id: string, dto: CancelDispatchDto, user: Usuario) {
    const dispatch = await this.findDispatch(id);
    if (
      dispatch.estado === DispatchStatus.DESPACHADO ||
      dispatch.estado === DispatchStatus.CANCELADO
    ) {
      throw new BadRequestException(`No se puede cancelar un despacho ${dispatch.estado}`);
    }
    await this.dataSource.transaction(async (em) => {
      const boxes = await em.find(Box, { where: { dispatchId: id, estado: BoxStatus.CERRADA } });
      for (const box of boxes) {
        const items = await em.find(BoxItem, { where: { boxId: box.id } });
        for (const it of items) {
          // Reversión: entradas positivas de Cantidad y bloqueada (mismo docTipo/docId)
          await this.movements.apply(
            {
              productId: it.productId,
              tipo: MovementType.DESPACHO_CIERRE_CAJA,
              cantidadDelta: it.cantidad,
              cantidadBloqueadaDelta: it.cantidad,
              docTipo: 'DESPACHO',
              docId: dispatch.id,
              usuarioId: user.id,
            },
            em,
          );
          await em.query(
            `UPDATE order_items SET cantidad_despachada = cantidad_despachada - $2 WHERE id = $1`,
            [it.orderItemId, it.cantidad],
          );
        }
        await em.update(Box, { id: box.id }, { estado: BoxStatus.ABIERTA, cerradaAt: null });
      }
      await em.update(
        Dispatch,
        { id },
        {
          estado: DispatchStatus.CANCELADO,
          motivoCancelacion: dto.motivo ?? null,
          canceladoAt: new Date(),
        },
      );
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'DESPACHO_CANCELADO',
          tabla: TABLA,
          registroId: id,
          motivo: dto.motivo,
          valorAnterior: { estado: dispatch.estado },
        },
        em,
      );
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // Helpers privados
  // ------------------------------------------------------------------
  private async findDispatch(id: string): Promise<Dispatch> {
    const d = await this.dataSource.getRepository(Dispatch).findOne({ where: { id } });
    if (!d) throw new NotFoundException('Despacho no encontrado');
    return d;
  }

  private async findBox(dispatchId: string, boxPk: string): Promise<Box> {
    const box = await this.dataSource
      .getRepository(Box)
      .findOne({ where: { id: boxPk, dispatchId } });
    if (!box) throw new NotFoundException('Caja no encontrada en este despacho');
    return box;
  }

  private assertEditable(dispatch: Dispatch) {
    if (
      dispatch.estado !== DispatchStatus.CREADO &&
      dispatch.estado !== DispatchStatus.PENDIENTE_CORRECCION
    ) {
      throw new BadRequestException(
        `Solo se modifican los pedidos en estado CREADO o PENDIENTE_CORRECCION (actual: ${dispatch.estado})`,
      );
    }
  }

  /** Pedido asociable: APROBADO, con pendientes, y sin otro despacho activo. */
  private async assertOrderAsociable(order: Order) {
    if (order.estado !== OrderStatus.APROBADO) {
      throw new BadRequestException(
        `El pedido ${order.numero} debe estar APROBADO para despacharse (actual: ${order.estado})`,
      );
    }
    const activo = await this.dataSource.query(
      `SELECT d.numero FROM dispatch_orders do2
       JOIN dispatches d ON d.id = do2.dispatch_id
       WHERE do2.order_id = $1 AND d.estado = ANY($2) LIMIT 1`,
      [order.id, ESTADOS_ACTIVOS],
    );
    if (activo.length > 0) {
      throw new BadRequestException(
        `El pedido ${order.numero} ya está en el despacho activo ${activo[0].numero}`,
      );
    }
    const pend = await this.dataSource.query(
      `SELECT COALESCE(SUM(cantidad_alistada - cantidad_despachada), 0) AS pend
       FROM order_items WHERE order_id = $1`,
      [order.id],
    );
    if (Number(pend[0]?.pend ?? 0) <= 0) {
      throw new BadRequestException(
        `El pedido ${order.numero} no tiene unidades pendientes por despachar`,
      );
    }
  }

  /**
   * Pendientes por línea de pedido del despacho: alistada − despachada,
   * descontando lo ya contado en cajas ABIERTAS de este despacho.
   */
  private async pendientes(dispatchId: string): Promise<PendienteItem[]> {
    const rows: any[] = await this.dataSource.query(
      `SELECT oi.id AS "orderItemId", oi.order_id AS "orderId", o.numero AS "numeroPedido",
              o.empresa_id AS "empresaId", oi.product_id AS "productId", oi.codigo,
              oi.descripcion, oi.cantidad_alistada AS "cantidadAlistada",
              oi.cantidad_despachada AS "cantidadDespachada",
              COALESCE((
                SELECT SUM(bi.cantidad) FROM box_items bi
                JOIN boxes b ON b.id = bi.box_id
                WHERE b.dispatch_id = $1 AND b.estado = 'ABIERTA' AND bi.order_item_id = oi.id
              ), 0) AS "enCajasAbiertas"
       FROM dispatch_orders do2
       JOIN orders o ON o.id = do2.order_id
       JOIN order_items oi ON oi.order_id = o.id
       WHERE do2.dispatch_id = $1 AND oi.cantidad_alistada > oi.cantidad_despachada`,
      [dispatchId],
    );
    return rows.map((r) => {
      const enCajasAbiertas = Number(r.enCajasAbiertas);
      const pendiente = calcularPendiente(
        Number(r.cantidadAlistada),
        Number(r.cantidadDespachada),
        enCajasAbiertas,
      );
      return {
        orderItemId: r.orderItemId,
        orderId: r.orderId,
        numeroPedido: r.numeroPedido,
        empresaId: r.empresaId,
        productId: r.productId,
        codigo: r.codigo,
        descripcion: r.descripcion,
        cantidadAlistada: Number(r.cantidadAlistada),
        cantidadDespachada: Number(r.cantidadDespachada),
        enCajasAbiertas,
        pendiente,
      };
    });
  }

  /**
   * Consecutivo de despacho GLOBAL DES-###### (B-1, spec v1.1: serie única y
   * compartida por todas las empresas). Secuencia nativa de PG: nextval() es
   * no-transaccional — nunca duplica aunque la transacción haga rollback, y
   * usa la misma conexión (compatible con pools de una sola conexión).
   */
  private async siguienteConsecutivo(em: EntityManager): Promise<string> {
    const rows: { ultimo: number }[] = await em.query(
      `SELECT nextval('dispatch_numero_seq') AS ultimo`,
    );
    const n = Number(rows[0]?.ultimo ?? 1);
    return formatNumeroDespacho(n);
  }

  /** boxId GLOBAL CJA-###### (M09 paso 3: único y compartido por todas las empresas). */
  private async siguienteBoxId(em: EntityManager): Promise<string> {
    const rows: { ultimo: number }[] = await em.query(
      `INSERT INTO box_counter (id, ultimo) VALUES (1, 1)
       ON CONFLICT (id) DO UPDATE SET ultimo = box_counter.ultimo + 1
       RETURNING ultimo`,
    );
    const n = rows[0]?.ultimo ?? 1;
    return formatBoxId(n);
  }

  /** Matching de código escaneado contra productos de una empresa (M07/M08). */
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
