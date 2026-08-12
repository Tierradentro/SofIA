import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { existsSync } from 'fs';
import { PqrsCase, PqrsStatus } from './entities/pqrs-case.entity';
import { PqrsSupport, PqrsSupportType } from './entities/pqrs-support.entity';
import { PqrsReason } from './entities/pqrs-reason.entity';
import { Product } from '../products/entities/product.entity';
import { ProductBarcode } from '../products/entities/product-barcode.entity';
import { Order } from '../orders/entities/order.entity';
import { InboundMatcher } from '../inbound/inbound-matcher';
import { MovementsService } from '../movements/movements.service';
import { MovementType } from '../../common/enums/movement-type.enum';
import { AuditService } from '../audit/audit.service';
import { DocumentsService, UploadedFilePayload } from '../documents/documents.service';
import { resolverFacturaCaso, validarReingreso } from './pqrs-helpers';
import { DocumentType } from '../../common/enums/document-type.enum';
import {
  CancelPqrsCaseDto,
  ClosePqrsCaseDto,
  CorrectPqrsCaseDto,
  CreatePqrsCaseDto,
  ReingresoDto,
  RequestCorrectionDto,
  SupportMetaDto,
} from './dto/pqrs.dto';

type Usuario = { id: string; username: string; rol?: string };

const TABLA = 'Casos PQRS';

export interface BusquedaResultado {
  pedidos: { id: string; numero: string; numeroFactura: string | null; clienteId: string; estado: string }[];
  despachos: { id: string; numero: string; clienteId: string; estado: string }[];
  cajas: { boxId: string; dispatchId: string; estado: string }[];
}

/**
 * M11 (EP-08): devoluciones (PQRS).
 * - Creación (Operador, HU-043): producto escaneado o seleccionado; búsqueda
 *   de pedido/despacho/caja/factura asociados (HU-044); sin coincidencia,
 *   factura manual (HU-045) u observación obligatoria (CU-007). Motivo
 *   obligatorio del catálogo G01–G40/N01–N18 (HU-047).
 * - Corrección: se solicita (PENDIENTE_CORRECCION) y el Generador corrige y
 *   devuelve a ABIERTA.
 * - Solución (Operador): registra el resultado y cierra (CERRADA), con
 *   soporte opcional de respuesta del proveedor.
 * - Cancelación: Generador, en cualquier punto del flujo.
 * - Reingreso al inventario: manual por el Generador como movimiento
 *   REINGRESO_DEVOLUCION (M11: "el Generador realiza el ajuste manualmente").
 */
@Injectable()
export class PqrsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly movements: MovementsService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  /** Catálogo de motivos (G01–G40 Garantía, N01–N18 Garantía No Aplica). */
  listReasons() {
    return this.dataSource.getRepository(PqrsReason).find({ order: { codigo: 'ASC' } });
  }

  // ------------------------------------------------------------------
  // HU-044: búsqueda automática por producto, caja, factura o despacho
  // ------------------------------------------------------------------
  async buscar(params: { codigo?: string; boxId?: string; factura?: string; despacho?: string }): Promise<BusquedaResultado> {
    const resultado: BusquedaResultado = { pedidos: [], despachos: [], cajas: [] };
    const { codigo, boxId, factura, despacho } = params;

    if (codigo?.trim()) {
      // Producto (en cualquiera de las empresas) → despachos que lo movieron
      const productos = await this.resolverProductos(codigo);
      for (const p of productos) {
        const rows: any[] = await this.dataSource.query(
          `SELECT DISTINCT o.id, o.numero, o.numero_factura AS "numeroFactura", o.cliente_id AS "clienteId", o.estado
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
           WHERE oi.product_id = $1`,
          [p.id],
        );
        resultado.pedidos.push(...rows);
        const desp: any[] = await this.dataSource.query(
          `SELECT DISTINCT d.id, d.numero, d.cliente_id AS "clienteId", d.estado
           FROM box_items bi
           JOIN boxes b ON b.id = bi.box_id
           JOIN dispatches d ON d.id = b.dispatch_id
           WHERE bi.product_id = $1`,
          [p.id],
        );
        resultado.despachos.push(...desp);
      }
    }

    if (boxId?.trim()) {
      const cajas: any[] = await this.dataSource.query(
        `SELECT box_id AS "boxId", dispatch_id AS "dispatchId", estado FROM boxes WHERE box_id = $1`,
        [boxId.trim().toUpperCase()],
      );
      resultado.cajas.push(...cajas);
      for (const c of cajas) {
        const d: any[] = await this.dataSource.query(
          `SELECT id, numero, cliente_id AS "clienteId", estado FROM dispatches WHERE id = $1`,
          [c.dispatchId],
        );
        resultado.despachos.push(...d);
      }
    }

    if (factura?.trim()) {
      const rows: any[] = await this.dataSource.query(
        `SELECT id, numero, numero_factura AS "numeroFactura", cliente_id AS "clienteId", estado
         FROM orders WHERE numero_factura = $1`,
        [factura.trim()],
      );
      resultado.pedidos.push(...rows);
    }

    if (despacho?.trim()) {
      const rows: any[] = await this.dataSource.query(
        `SELECT id, numero, cliente_id AS "clienteId", estado FROM dispatches WHERE numero = $1`,
        [despacho.trim().toUpperCase()],
      );
      resultado.despachos.push(...rows);
      for (const d of rows) {
        const cajas: any[] = await this.dataSource.query(
          `SELECT box_id AS "boxId", dispatch_id AS "dispatchId", estado FROM boxes WHERE dispatch_id = $1`,
          [d.id],
        );
        resultado.cajas.push(...cajas);
      }
    }

    // De-duplicar
    resultado.pedidos = [...new Map(resultado.pedidos.map((p) => [p.id, p])).values()];
    resultado.despachos = [...new Map(resultado.despachos.map((d) => [d.id, d])).values()];
    resultado.cajas = [...new Map(resultado.cajas.map((c) => [c.boxId, c])).values()];
    return resultado;
  }

  // ------------------------------------------------------------------
  // HU-043 / CU-006 / CU-007: crear caso (Operador) → ABIERTA
  // ------------------------------------------------------------------
  async create(dto: CreatePqrsCaseDto, user: Usuario) {
    const cliente = await this.dataSource
      .getRepository('clients')
      .findOne({ where: { id: dto.clienteId } });
    if (!cliente) throw new NotFoundException('Cliente no encontrado');

    const producto = await this.resolverProductoUnico(dto.codigo);
    if (!producto) {
      throw new NotFoundException(
        `El código ${dto.codigo} no corresponde a ningún producto registrado`,
      );
    }

    const motivo = await this.dataSource
      .getRepository(PqrsReason)
      .findOne({ where: { codigo: dto.motivoCodigo.trim().toUpperCase() } });
    if (!motivo) {
      throw new BadRequestException(`Motivo ${dto.motivoCodigo} no existe en el catálogo`);
    }

    // Validar asociaciones confirmadas por el Operador
    let order: Order | null = null;
    if (dto.orderId) {
      order = await this.dataSource
        .getRepository(Order)
        .findOne({ where: { id: dto.orderId } });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      const enPedido = await this.dataSource.query(
        `SELECT 1 FROM order_items WHERE order_id = $1 AND product_id = $2 LIMIT 1`,
        [order.id, producto.id],
      );
      if (enPedido.length === 0) {
        throw new BadRequestException(`El producto ${producto.codigo} no está en el pedido ${order.numero}`);
      }
    }
    if (dto.dispatchId) {
      const d = await this.dataSource
        .getRepository('dispatches')
        .findOne({ where: { id: dto.dispatchId } });
      if (!d) throw new NotFoundException('Despacho no encontrado');
    }

    // Factura: de la asociación o manual (HU-045). Sin ninguna → observación
    // obligatoria (CU-007).
    const { factura, facturaManual } = resolverFacturaCaso({
      facturaDigitada: dto.factura,
      facturaPedido: order?.numeroFactura ?? null,
      observacion: dto.facturaObservacion,
    });

    const caso = await this.dataSource.getRepository(PqrsCase).save(
      this.dataSource.getRepository(PqrsCase).create({
        clienteId: dto.clienteId,
        comercialId: dto.comercialId ?? null,
        productId: producto.id,
        codigo: producto.codigo,
        marca: producto.marca ?? null,
        descripcion: producto.descripcion,
        cantidad: dto.cantidad ?? 1,
        factura,
        facturaManual,
        facturaObservacion: dto.facturaObservacion?.trim() || null,
        motivoCodigo: motivo.codigo,
        detalle: dto.detalle?.trim() || null,
        descripcionCaso: dto.descripcionCaso.trim(),
        documento: dto.documento?.trim() || null,
        notas: dto.notas?.trim() || null,
        prioridad: dto.prioridad ?? undefined,
        estado: PqrsStatus.ABIERTA,
        orderId: dto.orderId ?? null,
        dispatchId: dto.dispatchId ?? null,
        boxId: dto.boxId?.trim().toUpperCase() || null,
        createdBy: user.id,
      }),
    );
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PQRS_CREADO',
      tabla: TABLA,
      registroId: caso.id,
      valorNuevo: {
        clienteId: caso.clienteId,
        codigo: caso.codigo,
        cantidad: caso.cantidad,
        motivo: caso.motivoCodigo,
        factura: caso.factura,
        orderId: caso.orderId,
      },
    });
    return this.get(caso.id);
  }

  // ------------------------------------------------------------------
  // HU-046: soportes fotográficos (recepción) y de respuesta (solución)
  // ------------------------------------------------------------------
  async addSupport(id: string, meta: SupportMetaDto, file: UploadedFilePayload, user: Usuario) {
    const caso = await this.findCase(id);
    if (caso.estado === PqrsStatus.CANCELADA) {
      throw new BadRequestException('No se adjuntan soportes a un caso CANCELADO');
    }
    const tipo = meta.tipo ?? PqrsSupportType.RECEPCION;
    if (tipo === PqrsSupportType.SOLUCION && caso.estado !== PqrsStatus.ABIERTA && caso.estado !== PqrsStatus.CERRADA) {
      throw new BadRequestException('El soporte de solución se adjunta con el caso ABIERTO o CERRADO');
    }
    if (!file) throw new BadRequestException('Archivo requerido');
    if (!file.mimetype?.startsWith('image/')) {
      throw new BadRequestException('El soporte debe ser una imagen');
    }
    const doc = await this.documents.store('pqrs', DocumentType.SOPORTE_PQRS, file, user.id);
    const soporte = await this.dataSource.getRepository(PqrsSupport).save(
      this.dataSource.getRepository(PqrsSupport).create({
        caseId: id,
        documentId: doc.id,
        tipo,
        observacion: meta.observacion?.trim() || null,
        createdBy: user.id,
      }),
    );
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PQRS_SOPORTE_ADJUNTADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { soporteId: soporte.id, tipo, nombre: doc.nombreOriginal },
    });
    return soporte;
  }

  /** Descarga de un soporte (imagen almacenada). */
  async getSupportFile(supportId: string) {
    const soporte = await this.dataSource
      .getRepository(PqrsSupport)
      .findOne({ where: { id: supportId } });
    if (!soporte) throw new NotFoundException('Soporte no encontrado');
    const doc = await this.dataSource
      .getRepository('documents')
      .findOne({ where: { id: soporte.documentId } }) as any;
    if (!doc) throw new NotFoundException('Archivo no encontrado');
    const absolutePath = this.documents.absolutePath(doc);
    if (!existsSync(absolutePath)) throw new NotFoundException('Archivo no disponible');
    return { doc, absolutePath };
  }

  // ------------------------------------------------------------------
  // M11 corrección: solicitar (→ PENDIENTE_CORRECCION) y corregir (→ ABIERTA)
  // ------------------------------------------------------------------
  async solicitarCorreccion(id: string, dto: RequestCorrectionDto, user: Usuario) {
    const caso = await this.findCase(id);
    if (caso.estado !== PqrsStatus.ABIERTA) {
      throw new BadRequestException('Solo se solicita corrección de un caso ABIERTO');
    }
    caso.estado = PqrsStatus.PENDIENTE_CORRECCION;
    await this.dataSource.getRepository(PqrsCase).save(caso);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PQRS_CORRECCION_SOLICITADA',
      tabla: TABLA,
      registroId: id,
      motivo: dto.motivo,
      valorNuevo: { estado: PqrsStatus.PENDIENTE_CORRECCION },
    });
    return this.get(id);
  }

  /** Generador corrige la información y devuelve el caso a ABIERTA. */
  async corregir(id: string, dto: CorrectPqrsCaseDto, user: Usuario) {
    const caso = await this.findCase(id);
    if (caso.estado !== PqrsStatus.PENDIENTE_CORRECCION) {
      throw new BadRequestException('Solo se corrige un caso PENDIENTE_CORRECCION');
    }
    const anterior: Record<string, any> = {};
    const nuevo: Record<string, any> = {};
    const campos: (keyof CorrectPqrsCaseDto)[] = [
      'comercialId', 'cantidad', 'factura', 'facturaObservacion', 'motivoCodigo',
      'detalle', 'descripcionCaso', 'documento', 'notas', 'prioridad',
    ];
    if (dto.motivoCodigo) {
      const motivo = await this.dataSource
        .getRepository(PqrsReason)
        .findOne({ where: { codigo: dto.motivoCodigo.trim().toUpperCase() } });
      if (!motivo) throw new BadRequestException(`Motivo ${dto.motivoCodigo} no existe en el catálogo`);
    }
    for (const campo of campos) {
      const valor = (dto as any)[campo];
      if (valor !== undefined) {
        anterior[campo] = (caso as any)[campo];
        (caso as any)[campo] = typeof valor === 'string' ? valor.trim() || null : valor;
        nuevo[campo] = (caso as any)[campo];
      }
    }
    // La cantidad reingresada no puede superar la nueva cantidad
    if (caso.cantidadReingresada > caso.cantidad) {
      throw new BadRequestException(
        `La cantidad (${caso.cantidad}) no puede ser menor que lo ya reingresado (${caso.cantidadReingresada})`,
      );
    }
    caso.estado = PqrsStatus.ABIERTA;
    caso.corregidoPor = user.id;
    await this.dataSource.getRepository(PqrsCase).save(caso);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PQRS_CORREGIDO',
      tabla: TABLA,
      registroId: id,
      motivo: dto.motivoCorreccion,
      valorAnterior: anterior,
      valorNuevo: { ...nuevo, estado: PqrsStatus.ABIERTA },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // M11 Solución: Operador registra el resultado y cierra (→ CERRADA)
  // ------------------------------------------------------------------
  async cerrar(id: string, dto: ClosePqrsCaseDto, user: Usuario) {
    const caso = await this.findCase(id);
    if (caso.estado !== PqrsStatus.ABIERTA) {
      throw new BadRequestException('Solo se cierra un caso ABIERTO');
    }
    caso.solucionCaso = dto.solucionCaso.trim();
    caso.estado = PqrsStatus.CERRADA;
    caso.cerradoPor = user.id;
    caso.cerradaAt = new Date();
    await this.dataSource.getRepository(PqrsCase).save(caso);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PQRS_CERRADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { estado: PqrsStatus.CERRADA, solucionCaso: caso.solucionCaso },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // Cancelación (Generador, en cualquier parte del flujo)
  // ------------------------------------------------------------------
  async cancel(id: string, dto: CancelPqrsCaseDto, user: Usuario) {
    const caso = await this.findCase(id);
    if (caso.estado === PqrsStatus.CERRADA || caso.estado === PqrsStatus.CANCELADA) {
      throw new BadRequestException(`No se puede cancelar un caso ${caso.estado}`);
    }
    caso.estado = PqrsStatus.CANCELADA;
    caso.motivoCancelacion = dto.motivo?.trim() || null;
    caso.canceladoAt = new Date();
    await this.dataSource.getRepository(PqrsCase).save(caso);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'PQRS_CANCELADO',
      tabla: TABLA,
      registroId: id,
      motivo: dto.motivo,
      valorAnterior: { estado: PqrsStatus.ABIERTA },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // Reingreso manual al inventario (M11: el Generador realiza el ajuste)
  // Movimiento REINGRESO_DEVOLUCION con trazabilidad al caso (D-01).
  // ------------------------------------------------------------------
  async reingresar(id: string, dto: ReingresoDto, user: Usuario) {
    const caso = await this.findCase(id);
    if (caso.estado === PqrsStatus.CANCELADA) {
      throw new BadRequestException('No se reingresa mercancía de un caso CANCELADO');
    }
    const cantidad = dto.cantidad ?? caso.cantidad - caso.cantidadReingresada;
    validarReingreso(caso.cantidad, caso.cantidadReingresada, cantidad);
    await this.dataSource.transaction(async (em) => {
      await this.movements.apply(
        {
          productId: caso.productId,
          tipo: MovementType.REINGRESO_DEVOLUCION,
          cantidadDelta: cantidad,
          docTipo: 'PQRS',
          docId: caso.id,
          usuarioId: user.id,
        },
        em,
      );
      await em.query(
        `UPDATE pqrs_cases SET cantidad_reingresada = cantidad_reingresada + $2 WHERE id = $1`,
        [caso.id, cantidad],
      );
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'PQRS_REINGRESO',
          tabla: TABLA,
          registroId: id,
          valorNuevo: { codigo: caso.codigo, cantidad, notas: dto.notas },
        },
        em,
      );
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // Consultas (M11: consultar caso; dashboard del cliente muestra sus PQRS)
  // ------------------------------------------------------------------
  async list(filters: { estado?: PqrsStatus; clienteId?: string; comercialId?: string }) {
    const qb = this.dataSource
      .getRepository(PqrsCase)
      .createQueryBuilder('c')
      .orderBy('c.createdAt', 'DESC');
    if (filters.estado) qb.andWhere('c.estado = :estado', { estado: filters.estado });
    if (filters.clienteId) qb.andWhere('c.clienteId = :clienteId', { clienteId: filters.clienteId });
    // Tablero del comercial (M02): solo casos asociados a su comercial
    if (filters.comercialId) qb.andWhere('c.comercialId = :comercialId', { comercialId: filters.comercialId });
    const casos = await qb.getMany();
    const clientes = await this.dataSource.getRepository('clients').find();
    const mapa = new Map(clientes.map((c: any) => [c.id, c.nombre]));
    return casos.map((c) => ({ ...c, clienteNombre: mapa.get(c.clienteId) ?? null }));
  }

  async get(id: string, user?: Usuario) {
    const caso = await this.findCase(id);
    // Tablero del comercial (M02): solo casos de su comercial
    if (user?.rol === 'COMERCIAL' && (user as any).comercialId
        && caso.comercialId !== (user as any).comercialId) {
      throw new NotFoundException('Caso PQRS no encontrado');
    }
    const cliente = await this.dataSource
      .getRepository('clients')
      .findOne({ where: { id: caso.clienteId } });
    const comercial = caso.comercialId
      ? await this.dataSource.getRepository('comerciales').findOne({ where: { id: caso.comercialId } })
      : null;
    const motivo = await this.dataSource
      .getRepository(PqrsReason)
      .findOne({ where: { codigo: caso.motivoCodigo } });
    const soportes = await this.dataSource
      .getRepository(PqrsSupport)
      .find({ where: { caseId: id }, order: { createdAt: 'ASC' } });
    const docsRepo = this.dataSource.getRepository('documents');
    const soportesDetalle: any[] = [];
    for (const s of soportes) {
      const doc = (await docsRepo.findOne({ where: { id: s.documentId } })) as any;
      soportesDetalle.push({
        ...s,
        nombreOriginal: doc?.nombreOriginal ?? null,
        mime: doc?.mime ?? null,
      });
    }
    let pedido: any = null;
    if (caso.orderId) {
      pedido = await this.dataSource.query(
        `SELECT numero, numero_factura AS "numeroFactura", estado FROM orders WHERE id = $1`,
        [caso.orderId],
      );
      pedido = pedido[0] ?? null;
    }
    let despacho: any = null;
    if (caso.dispatchId) {
      despacho = await this.dataSource.query(
        `SELECT numero, estado FROM dispatches WHERE id = $1`,
        [caso.dispatchId],
      );
      despacho = despacho[0] ?? null;
    }
    return { ...caso, cliente, comercial, motivo, soportes: soportesDetalle, pedido, despacho };
  }

  // ------------------------------------------------------------------
  // Helpers privados
  // ------------------------------------------------------------------
  private async findCase(id: string): Promise<PqrsCase> {
    const caso = await this.dataSource.getRepository(PqrsCase).findOne({ where: { id } });
    if (!caso) throw new NotFoundException('Caso PQRS no encontrado');
    return caso;
  }

  /** Producto(s) que coinciden con el código en cualquiera de las empresas. */
  private async resolverProductos(codigo: string): Promise<Product[]> {
    const productos = await this.dataSource.getRepository(Product).find();
    const barcodes = await this.dataSource.getRepository(ProductBarcode).find();
    const map = new Map<string, string>();
    for (const b of barcodes) map.set(b.barcode.trim().toUpperCase(), b.productId);
    const matcher = new InboundMatcher(productos, map);
    const { producto } = matcher.match(codigo);
    return producto ? [producto] : [];
  }

  /** Un solo producto por código (si hay duplicados entre empresas, el primero). */
  private async resolverProductoUnico(codigo: string): Promise<Product | null> {
    const encontrados = await this.resolverProductos(codigo);
    return encontrados[0] ?? null;
  }
}
