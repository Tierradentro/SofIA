import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { InboundReceipt, InboundStatus } from './entities/inbound-receipt.entity';
import { InboundItem } from './entities/inbound-item.entity';
import {
  ApproveInboundDto,
  CreateInboundDto,
  InboundItemDto,
  UpdateInboundDto,
} from './dto/inbound.dto';
import { Product } from '../products/entities/product.entity';
import { ProductBarcode } from '../products/entities/product-barcode.entity';
import { ProductStatus } from '../../common/enums/product-status.enum';
import { OcrDocument } from '../ocr/entities/ocr-document.entity';
import { DocumentType } from '../../common/enums/document-type.enum';
import { MovementsService } from '../movements/movements.service';
import { MovementType } from '../../common/enums/movement-type.enum';
import { AuditService } from '../audit/audit.service';
import { InventoriesService } from '../inventories/inventories.service';
import { InboundMatcher, compararItem } from './inbound-matcher';

const TABLA = 'inbound_receipts';

type Usuario = { id: string; username: string };

/**
 * M07/CU-001 (EP-06): ingreso de mercancía.
 * Flujo: Generador crea actividad (factura OCR o manual) → CREADO →
 * Operador inicia, registra caja principal (HU-023) y cantidades (HU-024) →
 * cierre de conteo compara y alerta diferencias (HU-025) → Generador aprueba
 * con observación obligatoria si hay diferencias o productos nuevos (HU-026)
 * → existencias actualizadas por movimientos INGRESO_APROBADO en una única
 * transacción. HU-027: ingreso parcial completable en Pendiente_Corrección.
 * Generador puede cancelar en cualquier momento antes de aprobar.
 */
@Injectable()
export class InboundService {
  constructor(
    @InjectRepository(InboundReceipt)
    private readonly receipts: Repository<InboundReceipt>,
    @InjectRepository(InboundItem)
    private readonly items: Repository<InboundItem>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly movements: MovementsService,
    private readonly audit: AuditService,
    private readonly inventories: InventoriesService,
  ) {}

  // ---------------------------------------------------------------
  // Paso 1-2 (M07): creación de la actividad (HU-022)
  // ---------------------------------------------------------------

  async create(dto: CreateInboundDto, user: Usuario) {
    let numeroFactura = dto.numeroFactura ?? null;
    let fechaFactura = dto.fechaFactura ?? null;
    let proveedor = dto.proveedor ?? null;
    let itemsDto: InboundItemDto[] = dto.items ?? [];
    let ocrDocumentId: string | null = null;

    if (dto.ocrDocumentId) {
      const ocrDoc = await this.dataSource
        .getRepository(OcrDocument)
        .findOne({ where: { id: dto.ocrDocumentId } });
      if (!ocrDoc) throw new NotFoundException('Documento OCR no encontrado');
      if (ocrDoc.tipoDocumento !== DocumentType.FACTURA_IMPORTACION) {
        throw new BadRequestException(
          'El documento OCR debe ser de tipo FACTURA_IMPORTACION',
        );
      }
      ocrDocumentId = ocrDoc.id;
      const d = ocrDoc.datosExtraidos as any;
      numeroFactura = numeroFactura ?? d.numeroFactura ?? null;
      fechaFactura = fechaFactura ?? d.fecha ?? null;
      proveedor = proveedor ?? d.proveedor ?? null;
      if (!itemsDto.length && Array.isArray(d.items)) {
        itemsDto = d.items.map((i: any) => ({
          referencia: String(i.referencia ?? ''),
          descripcion: i.descripcion ?? undefined,
          unidad: i.unidad ?? 'UND',
          cantidadFacturada: Number(i.cantidad) || 0,
        }));
      }
    }

    if (!itemsDto.length) {
      throw new BadRequestException(
        'La actividad de ingreso requiere al menos un producto (items)',
      );
    }
    for (const it of itemsDto) {
      if (!it.referencia?.trim()) {
        throw new BadRequestException('Cada item requiere referencia');
      }
    }

    const matcher = await this.buildMatcher(dto.empresaId);
    const receipt = await this.dataSource.transaction(async (em) => {
      const saved = await em.save(
        em.create(InboundReceipt, {
          empresaId: dto.empresaId,
          numeroFactura,
          fechaFactura,
          proveedor,
          estado: InboundStatus.CREADO,
          ocrDocumentId,
          createdBy: user.id,
        }),
      );
      for (const it of itemsDto) {
        const { producto } = matcher.match(it.referencia);
        await em.save(
          em.create(InboundItem, {
            receiptId: saved.id,
            referencia: it.referencia.trim(),
            descripcion: it.descripcion?.trim() || null,
            unidad: it.unidad?.trim() || 'UND',
            cantidadFacturada: it.cantidadFacturada,
            cantidadRecibida: 0,
            productId: producto?.id ?? null,
            esNuevo: !producto,
          }),
        );
      }
      return saved;
    });

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_CREADO',
      tabla: TABLA,
      registroId: receipt.id,
      valorNuevo: {
        empresaId: dto.empresaId,
        numeroFactura,
        proveedor,
        items: itemsDto.length,
        origen: ocrDocumentId ? 'OCR' : 'MANUAL',
      },
    });
    return this.getDetalle(receipt.id);
  }

  /** Corrección del Generador (documento no legible / pendiente corrección). */
  async update(id: string, dto: UpdateInboundDto, user: Usuario) {
    const receipt = await this.findOne(id);
    if (
      receipt.estado !== InboundStatus.CREADO &&
      receipt.estado !== InboundStatus.PENDIENTE_CORRECCION
    ) {
      throw new BadRequestException(
        `Solo se puede corregir en estado Creado o Pendiente_Corrección (actual: ${receipt.estado})`,
      );
    }
    const matcher = await this.buildMatcher(receipt.empresaId);
    await this.dataSource.transaction(async (em) => {
      if (dto.numeroFactura !== undefined) receipt.numeroFactura = dto.numeroFactura;
      if (dto.fechaFactura !== undefined) receipt.fechaFactura = dto.fechaFactura;
      if (dto.proveedor !== undefined) receipt.proveedor = dto.proveedor;
      await em.save(receipt);
      if (dto.items) {
        const anteriores = await em.find(InboundItem, {
          where: { receiptId: receipt.id },
        });
        await em.remove(anteriores);
        for (const it of dto.items) {
          const { producto } = matcher.match(it.referencia);
          await em.save(
            em.create(InboundItem, {
              receiptId: receipt.id,
              referencia: it.referencia.trim(),
              descripcion: it.descripcion?.trim() || null,
              unidad: it.unidad?.trim() || 'UND',
              cantidadFacturada: it.cantidadFacturada,
              cantidadRecibida: 0,
              productId: producto?.id ?? null,
              esNuevo: !producto,
            }),
          );
        }
        // Se reinicia el conteo tras corregir las líneas
        receipt.conteoCerrado = false;
        await em.save(receipt);
      }
    });
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_CORREGIDO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: dto as any,
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------
  // Paso 3 (M07): Operador — tarea, caja principal, cantidades
  // ---------------------------------------------------------------

  /** El Operador toma la tarea de ingreso (CREADO → EN_INGRESO). */
  async iniciar(id: string, user: Usuario) {
    const receipt = await this.findOne(id);
    if (receipt.estado !== InboundStatus.CREADO) {
      throw new BadRequestException(
        `Solo se puede iniciar un ingreso en estado Creado (actual: ${receipt.estado})`,
      );
    }
    receipt.estado = InboundStatus.EN_INGRESO;
    receipt.iniciadoPor = user.id;
    receipt.iniciadoAt = new Date();
    await this.receipts.save(receipt);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_INICIADO',
      tabla: TABLA,
      registroId: id,
    });
    return this.getDetalle(id);
  }

  /** HU-023: asociar código de caja principal / contenedor (trazabilidad). */
  async registrarCaja(id: string, codigoCaja: string, user: Usuario) {
    const receipt = await this.findOne(id);
    this.assertEnRecepcion(receipt);
    const anterior = receipt.cajaPrincipal;
    receipt.cajaPrincipal = codigoCaja.trim();
    await this.receipts.save(receipt);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_CAJA_PRINCIPAL',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior ? { cajaPrincipal: anterior } : null,
      valorNuevo: { cajaPrincipal: receipt.cajaPrincipal },
    });
    return this.getDetalle(id);
  }

  /** HU-024/HU-027: registrar cantidad recibida de un producto. */
  async registrarCantidad(
    id: string,
    itemId: string,
    cantidadRecibida: number,
    user: Usuario,
  ) {
    const receipt = await this.findOne(id);
    this.assertEnRecepcion(receipt);
    const item = await this.items.findOne({
      where: { id: itemId, receiptId: id },
    });
    if (!item) throw new NotFoundException('Item del ingreso no encontrado');
    // M12: durante un inventario EN_CONTEO el ingreso del producto se bloquea
    if (item.productId) {
      await this.inventories.assertNoBloqueo(item.productId, 'El ingreso de mercancía');
    }
    const anterior = item.cantidadRecibida;
    item.cantidadRecibida = cantidadRecibida;
    await this.items.save(item);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_CANTIDAD',
      tabla: 'inbound_items',
      registroId: itemId,
      valorAnterior: { referencia: item.referencia, cantidadRecibida: anterior },
      valorNuevo: { referencia: item.referencia, cantidadRecibida },
    });
    return this.getDetalle(id);
  }

  /**
   * Paso 4 (M07) / HU-025: cierre del conteo. El sistema compara y si hay
   * diferencias o productos nuevos bloquea el cierre definitivo dejando la
   * actividad en Pendiente_Corrección.
   */
  async cerrarConteo(id: string, user: Usuario) {
    const receipt = await this.findOne(id);
    this.assertEnRecepcion(receipt);
    const comparacion = await this.buildComparacion(id);
    receipt.conteoCerrado = true;
    if (comparacion.resumen.conDiferencias > 0 || comparacion.resumen.nuevos > 0) {
      receipt.estado = InboundStatus.PENDIENTE_CORRECCION;
    } else {
      receipt.estado = InboundStatus.EN_INGRESO;
    }
    await this.receipts.save(receipt);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_CIERRE_CONTEO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { estado: receipt.estado, ...comparacion.resumen },
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------
  // Paso 5 (M07): aprobación del Generador (HU-026) y cancelación
  // ---------------------------------------------------------------

  /**
   * HU-026: aprueba el ingreso. Con diferencias o productos nuevos exige
   * observación obligatoria. En una única transacción: crea los productos
   * nuevos (Generador aprueba su creación, CU-001) y aplica los movimientos
   * INGRESO_APROBADO por las cantidades recibidas (nunca sobrescritura).
   */
  async approve(id: string, dto: ApproveInboundDto, user: Usuario) {
    const receipt = await this.findOne(id);
    if (
      receipt.estado !== InboundStatus.EN_INGRESO &&
      receipt.estado !== InboundStatus.PENDIENTE_CORRECCION
    ) {
      throw new BadRequestException(
        `Solo se puede aprobar un ingreso En_ingreso o Pendiente_Corrección (actual: ${receipt.estado})`,
      );
    }
    if (!receipt.cajaPrincipal) {
      throw new BadRequestException(
        'Debe registrar la caja principal o contenedor antes de aprobar',
      );
    }
    if (!receipt.conteoCerrado) {
      throw new BadRequestException(
        'El Operador debe cerrar el conteo antes de aprobar (paso 4, M07)',
      );
    }
    const items = await this.items.find({ where: { receiptId: id } });
    const comparacion = items.map((it) => ({ item: it, ...compararItem(it) }));
    const conNovedad = comparacion.filter(
      (c) => c.estado !== 'COINCIDE',
    ).length;
    if (conNovedad > 0 && !dto.observacion?.trim()) {
      throw new BadRequestException(
        'La observación es obligatoria para aprobar un ingreso con diferencias o productos nuevos',
      );
    }

    const nuevosCreados: { referencia: string; productId: string }[] = [];
    await this.dataSource.transaction(async (em) => {
      for (const { item } of comparacion) {
        // Producto nuevo: creación automática aprobada por el Generador
        if (item.esNuevo && !item.productId) {
          const producto = await this.crearProductoNuevo(em, receipt, item, user);
          item.productId = producto.id;
          await em.save(item);
          nuevosCreados.push({ referencia: item.referencia, productId: producto.id });
        }
        // Movimiento de entrada por lo efectivamente recibido
        if (item.cantidadRecibida > 0 && item.productId) {
          await this.movements.apply(
            {
              productId: item.productId,
              tipo: MovementType.INGRESO_APROBADO,
              cantidadDelta: item.cantidadRecibida,
              docTipo: 'INGRESO',
              docId: receipt.id,
              usuarioId: user.id,
            },
            em,
          );
        }
      }
      receipt.estado = InboundStatus.APROBADO;
      receipt.aprobadoPor = user.id;
      receipt.aprobadoAt = new Date();
      receipt.observacionDiferencias = dto.observacion?.trim() || null;
      await em.save(receipt);
    });

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_APROBADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: {
        observacion: dto.observacion ?? null,
        productosNuevos: nuevosCreados.map((n) => n.referencia),
        itemsConMovimiento: comparacion.filter((c) => c.item.cantidadRecibida > 0).length,
      },
      motivo: dto.observacion ?? null,
    });
    return this.getDetalle(id);
  }

  /** Generador puede cancelar la actividad en cualquier momento del flujo. */
  async cancel(id: string, motivo: string | undefined, user: Usuario) {
    const receipt = await this.findOne(id);
    if (receipt.estado === InboundStatus.APROBADO) {
      throw new BadRequestException('Un ingreso aprobado no se puede cancelar');
    }
    if (receipt.estado === InboundStatus.CANCELADO) {
      throw new BadRequestException('El ingreso ya está cancelado');
    }
    const estadoAnterior = receipt.estado;
    receipt.estado = InboundStatus.CANCELADO;
    receipt.motivoCancelacion = motivo?.trim() || null;
    receipt.canceladoAt = new Date();
    await this.receipts.save(receipt);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_CANCELADO',
      tabla: TABLA,
      registroId: id,
      valorAnterior: { estado: estadoAnterior },
      valorNuevo: { estado: InboundStatus.CANCELADO },
      motivo: motivo ?? null,
    });
    return this.getDetalle(id);
  }

  // ---------------------------------------------------------------

  async findAll(empresaId?: string, estado?: InboundStatus) {
    const where: any = {};
    if (empresaId) where.empresaId = empresaId;
    if (estado) where.estado = estado;
    const receipts = await this.receipts.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });
    return receipts;
  }

  async getDetalle(id: string) {
    const receipt = await this.findOne(id);
    const items = await this.items.find({
      where: { receiptId: id },
      order: { createdAt: 'ASC' },
    });
    const comparacion = items.map((it) => ({
      ...it,
      ...compararItem(it),
    }));
    const resumen = {
      total: items.length,
      coincidencias: comparacion.filter((c) => c.estado === 'COINCIDE').length,
      faltantes: comparacion.filter((c) => c.estado === 'FALTANTE').length,
      sobrantes: comparacion.filter((c) => c.estado === 'SOBRANTE').length,
      nuevos: comparacion.filter((c) => c.estado === 'NUEVO').length,
      conDiferencias: comparacion.filter(
        (c) => c.estado === 'FALTANTE' || c.estado === 'SOBRANTE',
      ).length,
    };
    return { ...receipt, items: comparacion, resumen };
  }

  private async findOne(id: string): Promise<InboundReceipt> {
    const receipt = await this.receipts.findOne({ where: { id } });
    if (!receipt) throw new NotFoundException('Actividad de ingreso no encontrada');
    return receipt;
  }

  private assertEnRecepcion(receipt: InboundReceipt) {
    if (
      receipt.estado !== InboundStatus.EN_INGRESO &&
      receipt.estado !== InboundStatus.PENDIENTE_CORRECCION
    ) {
      throw new BadRequestException(
        `La actividad debe estar En_ingreso o Pendiente_Corrección (actual: ${receipt.estado})`,
      );
    }
  }

  private async buildComparacion(id: string) {
    const detalle = await this.getDetalle(id);
    return { resumen: detalle.resumen };
  }

  /** Matcher con los productos y barcodes de la empresa del ingreso. */
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

  /** CU-001: creación automática de producto nuevo (ubicación pendiente). */
  private async crearProductoNuevo(
    em: EntityManager,
    receipt: InboundReceipt,
    item: InboundItem,
    user: Usuario,
  ): Promise<Product> {
    const producto = await em.save(
      em.create(Product, {
        empresaId: receipt.empresaId,
        codigo: item.referencia,
        descripcion:
          item.descripcion?.trim() || `Producto nuevo ingreso ${receipt.numeroFactura ?? ''}`.trim(),
        unidadMedida: item.unidad || 'UND',
        cantidad: 0,
        cantidadBloqueada: 0,
        precio: 0,
        estado: ProductStatus.ACTIVO,
        observaciones: `Creado automáticamente por ingreso ${receipt.numeroFactura ?? receipt.id}. Completar atributos.`,
      }),
    );
    // Auditoría con la MISMA conexión de la transacción (pool max=1 en test)
    await this.audit.log(
      {
        usuarioId: user.id,
        usuarioUsername: user.username,
        accion: 'CREAR',
        tabla: 'Productos',
        registroId: producto.id,
        valorNuevo: producto as any,
        motivo: `Creación automática por ingreso de mercancía ${receipt.numeroFactura ?? receipt.id}`,
      },
      em,
    );
    return producto;
  }
}
