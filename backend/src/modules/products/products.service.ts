import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { ProductBarcode } from './entities/product-barcode.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { AssignBarcodeDto } from './dto/assign-barcode.dto';
import { AuditService } from '../audit/audit.service';
import { ProductStatus } from '../../common/enums/product-status.enum';

const TABLA = 'Productos'; // una de las 6 entidades auditables

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(ProductBarcode)
    private readonly barcodes: Repository<ProductBarcode>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * HU-009: crear producto (Generador). Multiempresa en backend: la empresa
   * es obligatoria y se valida; el código es único por empresa.
   */
  async create(dto: CreateProductDto, user: { id: string; username: string }) {
    await this.assertEmpresa(dto.empresaId);
    const dup = await this.products.findOne({
      where: { empresaId: dto.empresaId, codigo: dto.codigo },
    });
    if (dup) {
      throw new ConflictException(
        `Ya existe el producto con código '${dto.codigo}' en esa empresa`,
      );
    }
    const product = await this.products.save(
      this.products.create({
        ...dto,
        cantidad: 0,
        cantidadBloqueada: 0,
        estado: ProductStatus.ACTIVO,
      }),
    );
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: product.id,
      valorNuevo: product as any,
    });
    return this.withBarcode(product);
  }

  /** Edición (M05). No cambia empresa ni cantidades (solo movimientos). */
  async update(id: string, dto: UpdateProductDto, user: { id: string; username: string }) {
    const product = await this.findById(id);
    const { empresaId, ...rest } = dto as any;
    if (empresaId && empresaId !== product.empresaId) {
      throw new BadRequestException('No se puede cambiar la empresa del producto');
    }
    if (rest.codigo && rest.codigo !== product.codigo) {
      const dup = await this.products.findOne({
        where: { empresaId: product.empresaId, codigo: rest.codigo },
      });
      if (dup) {
        throw new ConflictException(
          `Ya existe el producto con código '${rest.codigo}' en esa empresa`,
        );
      }
    }
    const anterior = { ...product };
    Object.assign(product, rest);
    const saved = await this.products.save(product);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'EDITAR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior as any,
      valorNuevo: saved as any,
    });
    return this.withBarcode(saved);
  }

  /**
   * HU-011 / HU-012: asociar código de barras (escaneado o manual).
   * Regla M05: el código es único GLOBAL; si ya existe en cualquier empresa
   * se bloquea la asociación e informa el producto al que pertenece.
   */
  async assignBarcode(productId: string, dto: AssignBarcodeDto, user: { id: string; username: string }) {
    const product = await this.findById(productId);

    const existente = await this.barcodes.findOne({
      where: { barcode: dto.barcode },
    });
    if (existente) {
      if (existente.productId === productId) {
        return this.withBarcode(product); // idempotente: mismo producto, mismo código
      }
      const dueno = await this.findById(existente.productId);
      const empresa = await this.dataSource
        .getRepository('companies')
        .findOne({ where: { id: dueno.empresaId } }) as any;
      throw new ConflictException({
        statusCode: 409,
        code: 'BARCODE_DUPLICADO',
        message: `El código de barras ya está asociado a otro producto`,
        productoDueno: {
          codigo: dueno.codigo,
          descripcion: dueno.descripcion,
          empresa: empresa?.nombre ?? dueno.empresaId,
        },
      });
    }

    const actual = await this.barcodes.findOne({ where: { productId } });
    if (actual) {
      throw new ConflictException(
        `El producto ya tiene asociado el código '${actual.barcode}'; un producto tiene un único código de barras`,
      );
    }

    await this.barcodes.save(
      this.barcodes.create({
        barcode: dto.barcode,
        productId,
        origen: dto.origen,
        createdBy: user.id,
      }),
    );
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'ASOCIAR_BARCODE',
      tabla: TABLA,
      registroId: productId,
      valorAnterior: null,
      valorNuevo: { barcode: dto.barcode, origen: dto.origen },
    });
    return this.withBarcode(product);
  }

  /**
   * QA Func. 2.3: corrección de un código de barras mal asociado.
   * Transaccional: desasocia el actual y asocia el nuevo en una sola
   * operación; el código liberado queda disponible de inmediato. Audita
   * valor anterior y nuevo (corrección sensible).
   */
  async replaceBarcode(productId: string, dto: AssignBarcodeDto, user: { id: string; username: string }) {
    const product = await this.findById(productId);
    // Transacción mínima: solo los escritos. Las lecturas de respuesta se
    // hacen DESPUÉS, fuera de la transacción — mezclar un queryRunner
    // externo con el pool de 1 conexión de pruebas bloqueaba el release.
    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(ProductBarcode);

      const duplicado = await repo.findOne({ where: { barcode: dto.barcode } });
      if (duplicado && duplicado.productId !== productId) {
        throw new ConflictException('El código de barras ya está asociado a otro producto');
      }

      const actual = await repo.findOne({ where: { productId } });
      const valorAnterior = actual
        ? { barcode: actual.barcode, origen: actual.origen }
        : null;
      if (actual?.barcode === dto.barcode) return; // idempotente
      if (actual) await repo.remove(actual);
      await repo.save(
        repo.create({
          barcode: dto.barcode,
          productId,
          origen: dto.origen,
          createdBy: user.id,
        }),
      );
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'CORREGIR_BARCODE',
          tabla: TABLA,
          registroId: productId,
          valorAnterior,
          valorNuevo: { barcode: dto.barcode, origen: dto.origen },
        },
        em,
      );
    });
    return this.withBarcode(product);
  }

  /**
   * HU-013: consulta por código de barras, código, código OE o referencias
   * cruzadas. El barcode es global; el resto se resuelve por empresa.
   * Devuelve empresa, referencia, descripción, código de barras, ubicación
   * e inventario (cantidad y bloqueada).
   */
  async lookup(codigo: string, empresaId?: string) {
    // 1. Código de barras (global)
    const porBarcode = await this.barcodes.findOne({ where: { barcode: codigo } });
    if (porBarcode) {
      return this.detalle(await this.findById(porBarcode.productId));
    }
    // 2. Código exacto (por empresa si se indica)
    const whereCodigo: any = { codigo };
    if (empresaId) whereCodigo.empresaId = empresaId;
    const porCodigo = await this.products.findOne({ where: whereCodigo });
    if (porCodigo) return this.detalle(porCodigo);
    // 3. Código OE / referencias cruzadas (misma empresa)
    const qb = this.products
      .createQueryBuilder('p')
      .where('p.codigo_oe = :c OR p.ref_cruzada_1 = :c OR p.ref_cruzada_2 = :c', { c: codigo });
    if (empresaId) qb.andWhere('p.empresa_id = :empresaId', { empresaId });
    const porRef = await qb.getOne();
    if (porRef) return this.detalle(porRef);
    throw new NotFoundException(
      `No se encontró producto con el código o referencia '${codigo}'`,
    );
  }

  /**
   * Búsqueda por descripción (pg_trgm — criterio predominante, Spec §8).
   * Cada palabra del término debe aparecer en la descripción (AND de
   * ILIKE por palabra, soportado por el índice GIN trgm); el orden es por
   * similitud. Las existencias se visualizan juntas en el dashboard, pero
   * cada producto es de su empresa: si se pasa empresaId se filtra en backend.
   */
  /**
   * Búsqueda parcial (QA Func. 2.4): además de la descripción (pg_trgm),
   * admite coincidencia parcial en código, código OE y referencias cruzadas.
   * El barcode NO entra aquí: su match sigue siendo exacto vía lookup.
   */
  async search(q: string, empresaId?: string, limit = 25) {
    const texto = (q || '').trim();
    const palabras = texto.split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return [];
    const qb = this.products
      .createQueryBuilder('p')
      .addSelect(`similarity(p.descripcion, :qs)`, 'sim')
      .setParameter('qs', texto)
      .orderBy('sim', 'DESC')
      .take(Math.min(100, limit));
    // Cada palabra debe aparecer en algún identificador o en la descripción
    palabras.forEach((palabra, i) => {
      qb.andWhere(
        `(p.descripcion ILIKE :w${i} OR p.codigo ILIKE :w${i} OR p.codigo_oe ILIKE :w${i} OR p.ref_cruzada_1 ILIKE :w${i} OR p.ref_cruzada_2 ILIKE :w${i})`,
        { [`w${i}`]: `%${palabra}%` },
      );
    });
    if (empresaId) qb.andWhere('p.empresa_id = :empresaId', { empresaId });
    const items = await qb.getMany();
    return Promise.all(items.map((p) => this.detalle(p)));
  }

  /** Listado por empresa (dashboard: existencias por empresa). */
  async findByEmpresa(empresaId: string, soloActivos = true) {
    await this.assertEmpresa(empresaId);
    const where: any = { empresaId };
    if (soloActivos) where.estado = ProductStatus.ACTIVO;
    // Sin límite (I21): el formulario de pedido consume este listado y con
    // take:500 los productos por encima de 500 no aparecían al buscarlos.
    const items = await this.products.find({ where, order: { codigo: 'ASC' } });
    return Promise.all(items.map((p) => this.withBarcode(p)));
  }

  async findById(id: string): Promise<Product> {
    const product = await this.products.findOne({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  /** Detalle HU-013: empresa, referencia, descripción, barcode, ubicación e inventario. */
  async detalle(product: Product) {
    const conBarcode = await this.withBarcode(product);
    const empresa = (await this.dataSource
      .getRepository('companies')
      .findOne({ where: { id: product.empresaId } })) as any;
    return {
      ...conBarcode,
      empresa: empresa
        ? { id: empresa.id, nombre: empresa.nombre, siglas: empresa.siglas }
        : { id: product.empresaId },
      inventario: {
        cantidad: product.cantidad,
        cantidadBloqueada: product.cantidadBloqueada,
        disponible: product.cantidad - product.cantidadBloqueada,
      },
    };
  }

  private async withBarcode(product: Product) {
    const barcode = await this.barcodes.findOne({
      where: { productId: product.id },
    });
    return {
      ...product,
      codigoBarras: barcode
        ? { barcode: barcode.barcode, origen: barcode.origen }
        : null,
    };
  }

  private async assertEmpresa(empresaId: string) {
    const empresa = await this.dataSource
      .getRepository('companies')
      .findOne({ where: { id: empresaId, activo: true } });
    if (!empresa) {
      throw new BadRequestException('La empresa indicada no existe o está inactiva');
    }
  }
}
