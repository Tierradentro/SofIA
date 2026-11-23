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
import { Company } from '../companies/entities/company.entity';
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
      // I71: la factura de compra trae la empresa emisora (nombre y NIT).
      // Si se identifica y NO corresponde a la empresa del ingreso, se
      // rechaza: la mercancía no puede entrar al inventario de otra empresa.
      const empresaFactura = await this.empresaDeFactura(d);
      if (empresaFactura && empresaFactura.id !== dto.empresaId) {
        const seleccionada = await this.dataSource
          .getRepository(Company)
          .findOne({ where: { id: dto.empresaId } });
        throw new BadRequestException(
          `La factura ${numeroFactura ?? ''} pertenece a la empresa "${empresaFactura.nombre}" (${empresaFactura.siglas}) y el ingreso se está creando para "${seleccionada?.nombre ?? dto.empresaId}". Cambie de empresa o verifique la factura.`,
        );
      }
      if (!itemsDto.length && Array.isArray(d.items)) {
        itemsDto = d.items.map((i: any) => ({
          referencia: String(i.referencia ?? ''),
          descripcion: i.descripcion ?? undefined,
          unidad: i.unidad ?? 'UND',
          // I71: los decimales de la factura se descartan (solo el entero)
          cantidadFacturada: Math.trunc(Number(i.cantidad) || 0),
        }));
      }
    }

    if (!itemsDto.length) {
      throw new BadRequestException(
        'La actividad de ingreso requiere al menos un producto (items)',
      );
    }
    const matcher = await this.buildMatcher(dto.empresaId);
    // I39: las facturas de compra extranjera de algunos proveedores no traen
    // columna de referencia — el OCR extrae los ítems solo con descripción.
    // Se intenta cruzar por descripción exacta normalizada; si no hay
    // producto, se genera una referencia provisional SR-<factura>-<##> que
    // queda marcada como producto nuevo para corrección posterior.
    let seqProvisional = 0;
    for (const it of itemsDto) {
      if (it.referencia?.trim()) continue;
      if (!it.descripcion?.trim()) {
        throw new BadRequestException('Cada item requiere referencia');
      }
      const porDesc = matcher.matchPorDescripcion(it.descripcion);
      if (porDesc.producto) {
        it.referencia = porDesc.producto.codigo;
        continue;
      }
      seqProvisional += 1;
      it.referencia = this.referenciaProvisional(
        matcher,
        numeroFactura,
        seqProvisional,
      );
    }

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
        const producto = this.resolverProducto(matcher, it.referencia, it.descripcion);
        await em.save(
          em.create(InboundItem, {
            receiptId: saved.id,
            referencia: it.referencia.trim(),
            descripcion: it.descripcion?.trim() || null,
            unidad: it.unidad?.trim() || 'UND',
            cantidadFacturada: Math.trunc(it.cantidadFacturada),
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
          const producto = this.resolverProducto(matcher, it.referencia, it.descripcion);
          await em.save(
            em.create(InboundItem, {
              receiptId: receipt.id,
              referencia: it.referencia.trim(),
              descripcion: it.descripcion?.trim() || null,
              unidad: it.unidad?.trim() || 'UND',
              cantidadFacturada: Math.trunc(it.cantidadFacturada),
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
   * HU-026 + I71: aprueba el ingreso. La verificación del Operador es
   * OPCIONAL: el Generador (o el Administrador) puede aprobar directamente
   * por el TOTAL facturado de cada producto, sin caja ni cierre de conteo.
   * Con diferencias o productos nuevos exige observación obligatoria.
   * En una única transacción: crea los productos nuevos (CU-001, marcados
   * con ficha técnica pendiente) y aplica los movimientos INGRESO_APROBADO
   * que SUMAN a las existencias (nunca sobrescritura).
   */
  async approve(id: string, dto: ApproveInboundDto, user: Usuario) {
    const receipt = await this.findOne(id);
    if (
      receipt.estado !== InboundStatus.CREADO &&
      receipt.estado !== InboundStatus.EN_INGRESO &&
      receipt.estado !== InboundStatus.PENDIENTE_CORRECCION
    ) {
      throw new BadRequestException(
        `Solo se puede aprobar un ingreso Creado, En_ingreso o Pendiente_Corrección (actual: ${receipt.estado})`,
      );
    }
    // I71: sin cierre de conteo del Operador, el Generador da el ingreso por
    // el total de la mercancía facturada (las líneas sin cantidad registrada
    // entran por lo facturado; las que el Operador ya contó se respetan).
    const porTotalFactura = !receipt.conteoCerrado;
    if (!porTotalFactura && !receipt.cajaPrincipal) {
      throw new BadRequestException(
        'Debe registrar la caja principal o contenedor antes de aprobar',
      );
    }
    const items = await this.items.find({ where: { receiptId: id } });
    if (porTotalFactura) {
      for (const it of items) {
        if (!it.cantidadRecibida) it.cantidadRecibida = it.cantidadFacturada;
      }
    }
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
      // Seguridad (auditoría #1): la transición de estado es ATÓMICA dentro
      // de la transacción — dos aprobaciones simultáneas no pueden pasar las
      // dos: la segunda no encuentra fila y se aborta antes de sumar stock.
      const transicion = await em.query(
        `UPDATE inbound_receipts
            SET estado = 'APROBADO', aprobado_por = $2, aprobado_at = NOW(),
                observacion_diferencias = $3
          WHERE id = $1 AND estado IN ('CREADO', 'EN_INGRESO', 'PENDIENTE_CORRECCION')
          RETURNING id`,
        [id, user.id, dto.observacion?.trim() || null],
      );
      if (!transicion.length) {
        throw new BadRequestException(
          'El ingreso ya fue aprobado o cancelado por otra operación',
        );
      }
      for (const { item } of comparacion) {
        if (porTotalFactura) await em.save(item); // cantidad rellenada
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
    });

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INGRESO_APROBADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: {
        observacion: dto.observacion ?? null,
        numeroFactura: receipt.numeroFactura,
        porTotalFactura,
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

  async findAll(empresaId?: string, estado?: InboundStatus, limite?: number, pagina = 1) {
    const where: any = {};
    if (empresaId) where.empresaId = empresaId;
    if (estado) where.estado = estado;
    // I43: limite=0 (o «todos») quita el tope; sin parámetro se conserva 200.
    // I56: skip/take por página y total para el paginador del frontend.
    const take = limite === 0 ? undefined : (limite ?? 200);
    const [receipts, total] = await this.receipts.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      ...(take === undefined ? {} : { skip: (pagina - 1) * take, take }),
    });
    return { items: receipts, total };
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

  /**
   * I71: cruce del ítem contra el catálogo — exacto primero (código, OE,
   * referencias cruzadas, barcode); si no hay, los ajustes del módulo de
   * pedidos para el código truncado por la factura (I60): código parcial
   * con desempate por descripción, siempre único. Se completa con la
   * descripción exacta normalizada (I39).
   * El cruce SOLO por descripción aproximada no aplica al catálogo
   * completo: productos distintos comparten casi toda la descripción
   * ("GOL" vs "GOLF3") y el ingreso sumaría al producto errado.
   */
  private resolverProducto(
    matcher: InboundMatcher,
    referencia: string,
    descripcion?: string | null,
  ): Product | null {
    const exacto = matcher.match(referencia);
    if (exacto.producto) return exacto.producto;
    const parcial = matcher.matchParcial(referencia, descripcion);
    if (
      parcial.producto &&
      (parcial.criterio === 'CODIGO_PARCIAL' ||
        parcial.criterio === 'CODIGO_PARCIAL_DESCRIPCION')
    ) {
      return parcial.producto;
    }
    return matcher.matchPorDescripcion(descripcion).producto;
  }

  /**
   * I71: identifica la empresa EMISORA de la factura de compra (los datos
   * que el OCR extrajo del encabezado). Se intenta por NIT (con o sin
   * dígito de verificación), luego por nombre y finalmente por siglas
   * (iniciales de las palabras significativas del nombre). Si no se puede
   * identificar se devuelve null y el ingreso continúa sin bloqueo.
   */
  private async empresaDeFactura(d: any): Promise<Company | null> {
    const empresas = await this.dataSource.getRepository(Company).find();
    const nitFactura = String(d?.nitEmpresa ?? '').replace(/\D/g, '');
    if (nitFactura.length >= 5) {
      const porNit = empresas.find((e) => {
        const nit = String(e.identificacion ?? '').replace(/\D/g, '');
        return (
          nit.length >= 5 &&
          (nit === nitFactura ||
            nit.startsWith(nitFactura) ||
            nitFactura.startsWith(nit))
        );
      });
      if (porNit) return porNit;
    }
    const nombre = this.normalizarEmpresa(d?.empresaFactura);
    if (!nombre) return null;
    const porNombre = empresas.find((e) => {
      const ne = this.normalizarEmpresa(e.nombre);
      return !!ne && (nombre.includes(ne) || ne.includes(nombre));
    });
    if (porNombre) return porNombre;
    // Siglas = iniciales de las palabras significativas del nombre
    // ("IMPORT - REPUESTOS EL ESCARABAJO S A S" → IRE)
    const iniciales = nombre
      .split(' ')
      .filter(
        (w) =>
          w.length >= 2 &&
          !['DE', 'DEL', 'LA', 'EL', 'LOS', 'LAS', 'EN', 'SAS', 'SA', 'LTDA'].includes(w),
      )
      .map((w) => w[0])
      .join('');
    if (iniciales.length >= 2) {
      const porSiglas = empresas.find(
        (e) => (e.siglas ?? '').trim().toUpperCase() === iniciales,
      );
      if (porSiglas) return porSiglas;
    }
    return null;
  }

  private normalizarEmpresa(s: unknown): string {
    return String(s ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
  }

  /**
   * I39: referencia provisional para ítems sin código en el documento
   * (SR-<factura>-<##>), única contra los códigos existentes de la empresa.
   * El producto creado al aprobar queda con este código, editable después.
   */
  private referenciaProvisional(
    matcher: InboundMatcher,
    numeroFactura: string | null,
    seq: number,
  ): string {
    const base = (
      (numeroFactura ?? 'SINFACTURA').replace(/[^A-Za-z0-9]/g, '').toUpperCase() ||
      'SINFACTURA'
    ).slice(0, 12);
    let candidato = `SR-${base}-${String(seq).padStart(2, '0')}`;
    let extra = 0;
    while (matcher.existeCodigo(candidato)) {
      extra += 1;
      candidato = `SR-${base}-${String(seq).padStart(2, '0')}${String.fromCharCode(64 + extra)}`;
    }
    return candidato;
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
        // I71: queda marcado — la ficha técnica se completa manualmente y,
        // mientras tenga la marca, el producto permite editar TODOS sus
        // campos (incluido el código provisional).
        fichaPendiente: true,
        observaciones: `Creado automáticamente por ingreso ${receipt.numeroFactura ?? receipt.id}. Ficha técnica pendiente: complete los datos manualmente.`,
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
