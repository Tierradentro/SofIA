import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { StockCount, StockCountStatus } from './entities/stock-count.entity';
import { StockCountItem } from './entities/stock-count-item.entity';
import { Product } from '../products/entities/product.entity';
import { ProductBarcode } from '../products/entities/product-barcode.entity';
import { InboundMatcher } from '../inbound/inbound-matcher';
import { MovementsService } from '../movements/movements.service';
import { MovementType } from '../../common/enums/movement-type.enum';
import { AuditService } from '../audit/audit.service';
import { calcularDiferencia, formatNumeroInventario, valorEstimadoDiferencia } from './inventory-helpers';
import {
  CancelStockCountDto,
  CountItemDto,
  CreateStockCountDto,
  DocumentarDiferenciasDto,
} from './dto/inventory.dto';

type Usuario = { id: string; username: string; rol?: string };

const TABLA = 'Inventarios';

/**
 * M12 (EP-09): inventarios por empresa.
 * - Creación (Generador, HU-048): jornada de UNA empresa con instrucción y
 *   snapshot de existencias (la comparación es contra el snapshot).
 * - Conteo (Operador, HU-049): escaneo o manual, cantidad y ubicación.
 * - Comparación (Sistema, HU-050): Diferencia = Conteo − Existencia(snapshot),
 *   con valor estimado (diferencia × precio snapshot).
 * - Aprobación (Generador, HU-051): documenta cada diferencia y aprueba;
 *   el ajuste se aplica como movimientos AJUSTE_INVENTARIO (D-01).
 * - Cancelación (Generador, HU-052): con motivo, existencias sin cambio.
 * - Mientras la jornada está EN_CONTEO se bloquean alistamiento, despacho e
 *   ingreso de los productos incluidos (M12); crear/aprobar pedidos sí.
 */
@Injectable()
export class InventoriesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly movements: MovementsService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------
  // HU-048: crear jornada con snapshot (Generador)
  // ------------------------------------------------------------------
  async create(dto: CreateStockCountDto, user: Usuario) {
    const empresa = (await this.dataSource
      .getRepository('companies')
      .findOne({ where: { id: dto.empresaId } })) as any;
    if (!empresa) throw new NotFoundException('Empresa no encontrada');

    const productsRepo = this.dataSource.getRepository(Product);
    const productos: Product[] = [];
    for (const pid of new Set(dto.productIds)) {
      const p = await productsRepo.findOne({ where: { id: pid } });
      if (!p) throw new NotFoundException(`Producto ${pid} no encontrado`);
      if (p.empresaId !== dto.empresaId) {
        throw new BadRequestException(
          `El producto ${p.codigo} no pertenece a ${empresa.nombre}: un inventario nunca mezcla empresas (HU-048/CU-008)`,
        );
      }
      productos.push(p);
    }

    // Una sola jornada activa por empresa
    const activa = await this.dataSource.getRepository(StockCount).count({
      where: [
        { empresaId: dto.empresaId, estado: StockCountStatus.EN_CONTEO },
        { empresaId: dto.empresaId, estado: StockCountStatus.PENDIENTE_APROBACION },
      ],
    });
    if (activa > 0) {
      throw new ConflictException(
        `Ya hay una jornada de inventario activa para ${empresa.nombre}`,
      );
    }

    const countId = await this.dataSource.transaction(async (em) => {
      const numero = await this.siguienteConsecutivo(em, dto.empresaId, empresa.siglas);
      const jornada = await em.save(
        em.create(StockCount, {
          empresaId: dto.empresaId,
          numero,
          instruccion: dto.instruccion.trim(),
          estado: StockCountStatus.EN_CONTEO,
          createdBy: user.id,
        }),
      );
      for (const p of productos) {
        await em.save(
          em.create(StockCountItem, {
            countId: jornada.id,
            productId: p.id,
            codigo: p.codigo,
            descripcion: p.descripcion,
            existenciaSnapshot: p.cantidad,
            precioSnapshot: p.precio as any,
          }),
        );
      }
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'INVENTARIO_CREADO',
          tabla: TABLA,
          registroId: jornada.id,
          valorNuevo: {
            numero,
            empresa: empresa.nombre,
            productos: productos.map((p) => ({ codigo: p.codigo, snapshot: p.cantidad })),
          },
        },
        em,
      );
      return jornada.id;
    });
    return this.get(countId);
  }

  // ------------------------------------------------------------------
  // HU-049: conteo físico (Operador) — escaneo o manual, con ubicación
  // ------------------------------------------------------------------
  async registrarConteo(id: string, dto: CountItemDto, user: Usuario) {
    const jornada = await this.findCount(id);
    if (jornada.estado !== StockCountStatus.EN_CONTEO) {
      throw new BadRequestException('Solo se cuenta en una jornada EN_CONTEO');
    }
    const items = await this.dataSource
      .getRepository(StockCountItem)
      .find({ where: { countId: id } });

    // Resolver el código escaneado contra los productos de la empresa
    const matcher = await this.buildMatcher(jornada.empresaId);
    const { producto } = matcher.match(dto.codigo);
    if (!producto) {
      throw new BadRequestException(
        `El código ${dto.codigo} no corresponde a ningún producto de la empresa`,
      );
    }
    const item = items.find((i) => i.productId === producto.id);
    if (!item) {
      throw new BadRequestException(
        `El producto ${producto.codigo} no está incluido en esta jornada`,
      );
    }
    item.conteo = dto.conteo;
    item.ubicacion = dto.ubicacion?.trim() || item.ubicacion;
    item.contadoPor = user.id;
    item.contadoAt = new Date();
    await this.dataSource.getRepository(StockCountItem).save(item);
    return this.get(id);
  }

  /** Operador finaliza el conteo → PENDIENTE_APROBACION. */
  async finalizarConteo(id: string, user: Usuario) {
    const jornada = await this.findCount(id);
    if (jornada.estado !== StockCountStatus.EN_CONTEO) {
      throw new BadRequestException('La jornada no está EN_CONTEO');
    }
    const sinContar = await this.dataSource
      .getRepository(StockCountItem)
      .createQueryBuilder('i')
      .where('i.count_id = :id AND i.conteo IS NULL', { id })
      .getCount();
    if (sinContar > 0) {
      throw new BadRequestException(
        `Hay ${sinContar} producto(s) sin contar; registre el conteo de todos antes de finalizar`,
      );
    }
    jornada.estado = StockCountStatus.PENDIENTE_APROBACION;
    jornada.cerradoPor = user.id;
    jornada.cerradoAt = new Date();
    await this.dataSource.getRepository(StockCount).save(jornada);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INVENTARIO_CONTEO_FINALIZADO',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { estado: StockCountStatus.PENDIENTE_APROBACION },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // HU-051: documentar diferencias (Generador, obligatorio si hay diferencia)
  // ------------------------------------------------------------------
  async documentarDiferencias(id: string, dto: DocumentarDiferenciasDto, user: Usuario) {
    const jornada = await this.findCount(id);
    if (jornada.estado !== StockCountStatus.PENDIENTE_APROBACION) {
      throw new BadRequestException('La jornada no está PENDIENTE_APROBACION');
    }
    const repo = this.dataSource.getRepository(StockCountItem);
    for (const n of dto.notas) {
      const item = await repo.findOne({ where: { id: n.itemId, countId: id } });
      if (!item) throw new NotFoundException(`Ítem ${n.itemId} no encontrado en la jornada`);
      item.notaDiferencia = n.nota.trim();
      await repo.save(item);
    }
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INVENTARIO_DIFERENCIAS_DOCUMENTADAS',
      tabla: TABLA,
      registroId: id,
      valorNuevo: { items: dto.notas.length },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // HU-051 + Actualización (M12): aprobar → ajustes AJUSTE_INVENTARIO
  // en una única transacción; bloqueos liberados al terminar.
  // ------------------------------------------------------------------
  async aprobar(id: string, user: Usuario) {
    const jornada = await this.findCount(id);
    if (jornada.estado !== StockCountStatus.PENDIENTE_APROBACION) {
      throw new BadRequestException('Solo se aprueba una jornada PENDIENTE_APROBACION');
    }
    const items = await this.dataSource
      .getRepository(StockCountItem)
      .find({ where: { countId: id } });

    const diferencias = items.filter((i) => (i.conteo ?? 0) - i.existenciaSnapshot !== 0);
    const sinDocumentar = diferencias.filter((i) => !i.notaDiferencia?.trim());
    if (sinDocumentar.length > 0) {
      throw new BadRequestException(
        `Documente la diferencia de: ${sinDocumentar.map((i) => i.codigo).join(', ')} (M12 Aprobación)`,
      );
    }

    await this.dataSource.transaction(async (em) => {
      for (const item of diferencias) {
        const delta = calcularDiferencia(item.conteo ?? 0, item.existenciaSnapshot);
        await this.movements.apply(
          {
            productId: item.productId,
            tipo: MovementType.AJUSTE_INVENTARIO,
            cantidadDelta: delta,
            docTipo: 'INVENTARIO',
            docId: jornada.id,
            usuarioId: user.id,
          },
          em,
        );
      }
      await em.update(
        StockCount,
        { id },
        { estado: StockCountStatus.APROBADO, aprobadoPor: user.id, aprobadoAt: new Date() },
      );
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'INVENTARIO_APROBADO',
          tabla: TABLA,
          registroId: id,
          valorNuevo: {
            estado: StockCountStatus.APROBADO,
            ajustes: diferencias.map((i) => ({
              codigo: i.codigo,
              delta: (i.conteo ?? 0) - i.existenciaSnapshot,
              nota: i.notaDiferencia,
            })),
          },
        },
        em,
      );
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // HU-052: cancelar con motivo; existencias sin cambio
  // ------------------------------------------------------------------
  async cancel(id: string, dto: CancelStockCountDto, user: Usuario) {
    const jornada = await this.findCount(id);
    if (
      jornada.estado !== StockCountStatus.EN_CONTEO &&
      jornada.estado !== StockCountStatus.PENDIENTE_APROBACION
    ) {
      throw new BadRequestException(`No se puede cancelar una jornada ${jornada.estado}`);
    }
    jornada.estado = StockCountStatus.CANCELADO;
    jornada.motivoCancelacion = dto.motivo.trim();
    jornada.canceladoAt = new Date();
    await this.dataSource.getRepository(StockCount).save(jornada);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'INVENTARIO_CANCELADO',
      tabla: TABLA,
      registroId: id,
      motivo: dto.motivo,
      valorAnterior: { estado: StockCountStatus.EN_CONTEO },
    });
    return this.get(id);
  }

  // ------------------------------------------------------------------
  // M12 Bloqueos: ¿hay jornada EN_CONTEO que incluya este producto?
  // Lo consultan orders.scan, dispatches.scanToBox/closeBox e inbound.
  // ------------------------------------------------------------------
  async productoBloqueado(productId: string): Promise<{ bloqueado: boolean; numero?: string }> {
    const rows: { numero: string }[] = await this.dataSource.query(
      `SELECT sc.numero FROM stock_count_items sci
       JOIN stock_counts sc ON sc.id = sci.count_id
       WHERE sci.product_id = $1 AND sc.estado = 'EN_CONTEO'
       LIMIT 1`,
      [productId],
    );
    return rows.length > 0 ? { bloqueado: true, numero: rows[0].numero } : { bloqueado: false };
  }

  /** Lanza si el producto está bloqueado por inventario en conteo (M12). */
  async assertNoBloqueo(productId: string, operacion: string): Promise<void> {
    const { bloqueado, numero } = await this.productoBloqueado(productId);
    if (bloqueado) {
      throw new ConflictException({
        statusCode: 409,
        code: 'BLOQUEADO_POR_INVENTARIO',
        message: `${operacion} bloqueada: el producto está incluido en la jornada de inventario ${numero} (EN_CONTEO). Espere a que se apruebe o cancele (M12)`,
      });
    }
  }

  // ------------------------------------------------------------------
  // Consultas (dashboard del Operador lista las jornadas activas)
  // ------------------------------------------------------------------
  async list(filters: { empresaId?: string; estado?: StockCountStatus }) {
    const qb = this.dataSource
      .getRepository(StockCount)
      .createQueryBuilder('sc')
      .orderBy('sc.createdAt', 'DESC');
    if (filters.empresaId) qb.andWhere('sc.empresaId = :e', { e: filters.empresaId });
    if (filters.estado) qb.andWhere('sc.estado = :s', { s: filters.estado });
    const jornadas = await qb.getMany();
    const itemsRepo = this.dataSource.getRepository(StockCountItem);
    const out: any[] = [];
    for (const j of jornadas) {
      const items = await itemsRepo.find({ where: { countId: j.id } });
      out.push({
        ...j,
        totalItems: items.length,
        contados: items.filter((i) => i.conteo !== null).length,
        conDiferencia: items.filter((i) => i.conteo !== null && i.conteo - i.existenciaSnapshot !== 0).length,
      });
    }
    return out;
  }

  /** Detalle con comparación (HU-050): snapshot, conteo, diferencia y valor. */
  async get(id: string) {
    const jornada = await this.findCount(id);
    const empresa = (await this.dataSource
      .getRepository('companies')
      .findOne({ where: { id: jornada.empresaId } })) as any;
    const items = await this.dataSource
      .getRepository(StockCountItem)
      .find({ where: { countId: id }, order: { codigo: 'ASC' } });
    return {
      ...jornada,
      empresa: empresa ? { id: empresa.id, nombre: empresa.nombre, siglas: empresa.siglas } : null,
      items: items.map((i) => {
        const diferencia = i.conteo === null ? null : calcularDiferencia(i.conteo, i.existenciaSnapshot);
        return {
          ...i,
          diferencia,
          valorEstimado: diferencia === null ? null : valorEstimadoDiferencia(diferencia, Number(i.precioSnapshot)),
        };
      }),
    };
  }

  // ------------------------------------------------------------------
  // Helpers privados
  // ------------------------------------------------------------------
  private async findCount(id: string): Promise<StockCount> {
    const j = await this.dataSource.getRepository(StockCount).findOne({ where: { id } });
    if (!j) throw new NotFoundException('Jornada de inventario no encontrada');
    return j;
  }

  /** Consecutivo INV-SIGLAS-#### por empresa (UPSERT atómico). */
  private async siguienteConsecutivo(
    em: EntityManager,
    empresaId: string,
    siglas: string,
  ): Promise<string> {
    const rows: { ultimo: number }[] = await em.query(
      `INSERT INTO inventory_counters (empresa_id, ultimo) VALUES ($1, 1)
       ON CONFLICT (empresa_id) DO UPDATE SET ultimo = inventory_counters.ultimo + 1
       RETURNING ultimo`,
      [empresaId],
    );
    const n = rows[0]?.ultimo ?? 1;
    return formatNumeroInventario(siglas, n);
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
