import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseFloor } from './entities/warehouse-floor.entity';
import { WarehouseAisle } from './entities/warehouse-aisle.entity';
import { WarehouseZone, ZonaLado } from './entities/warehouse-zone.entity';
import { WarehouseRack } from './entities/warehouse-rack.entity';
import { WarehouseArea, AreaTipo } from './entities/warehouse-area.entity';
import { WarehouseProductLocation } from './entities/warehouse-product-location.entity';
import { Product } from '../products/entities/product.entity';
import { AuditService } from '../audit/audit.service';
import { ConfigureWarehouseDto } from './dto/configure-warehouse.dto';
import { AssignLocationDto, MoveCajonDto } from './dto/warehouse-ops.dto';

const TABLA = 'warehouses';

/**
 * HU-014/HU-057/HU-059 (EP-11 / M16): configuración y consulta del mapa 2D de
 * bodega. La bodega es compartida por todas las empresas (IRE/ICV).
 */
@Injectable()
export class WarehousesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Warehouse) private readonly warehouses: Repository<Warehouse>,
    @InjectRepository(WarehouseProductLocation)
    private readonly locations: Repository<WarehouseProductLocation>,
    private readonly audit: AuditService,
  ) {}

  /** Bodega activa (una por despliegue). */
  async getBodega(): Promise<Warehouse> {
    const w = await this.warehouses.findOne({ where: { activo: true } });
    if (!w) throw new NotFoundException('No hay bodega configurada');
    return w;
  }

  /**
   * Mapa 2D completo: estructura de la bodega (pisos, pasillos, zonas,
   * estantes, áreas) con la ocupación por productos. Para el mapa y las
   * pestañas por piso.
   */
  async getMapa() {
    const bodega = await this.getBodega();
    const pisos = await this.dataSource.getRepository(WarehouseFloor).find({
      where: { warehouseId: bodega.id },
      order: { numero: 'ASC' },
    });
    const floorIds = pisos.map((p) => p.id);
    const pasillos = floorIds.length
      ? await this.dataSource.getRepository(WarehouseAisle).find({
          where: { floorId: In(floorIds) },
          order: { numero: 'ASC' },
        })
      : [];
    const aisleIds = pasillos.map((p) => p.id);
    const zonas = aisleIds.length
      ? await this.dataSource.getRepository(WarehouseZone).find({
          where: { aisleId: In(aisleIds) },
        })
      : [];
    const zoneIds = zonas.map((z) => z.id);
    const estantes = zoneIds.length
      ? await this.dataSource.getRepository(WarehouseRack).find({
          where: { zoneId: In(zoneIds) },
          order: { numero: 'ASC' },
        })
      : [];
    const areas = floorIds.length
      ? await this.dataSource.getRepository(WarehouseArea).find({
          where: { floorId: In(floorIds) },
        })
      : [];

    const rackIds = estantes.map((r) => r.id);
    const areaIds = areas.map((a) => a.id);
    const ubicaciones =
      rackIds.length || areaIds.length
        ? await this.locations.find({
            where: [{ rackId: In(rackIds.length ? rackIds : ['__']) }, { areaId: In(areaIds.length ? areaIds : ['__']) }, { transito: true }] as any,
            relations: ['product'],
          })
        : await this.locations.find({ where: { transito: true }, relations: ['product'] });

    // Ocupación por estante: cantidad total, niveles ocupados y empresas
    // presentes (I33: filtro por empresa en el mapa 2D).
    const porRack = new Map<string, { cantidad: number; niveles: Set<number>; empresas: Map<string, number> }>();
    const porArea = new Map<string, { cantidad: number; empresas: Map<string, number> }>();
    let enTransito = 0;
    const sumarEmpresa = (m: Map<string, number>, empresaId: string | undefined, cantidad: number) => {
      if (!empresaId) return;
      m.set(empresaId, (m.get(empresaId) ?? 0) + cantidad);
    };
    for (const u of ubicaciones) {
      if (u.transito) enTransito += u.cantidad;
      if (u.rackId) {
        const e = porRack.get(u.rackId) ?? { cantidad: 0, niveles: new Set<number>(), empresas: new Map<string, number>() };
        e.cantidad += u.cantidad;
        if (u.nivel) e.niveles.add(u.nivel);
        sumarEmpresa(e.empresas, u.product?.empresaId, u.cantidad);
        porRack.set(u.rackId, e);
      } else if (u.areaId) {
        const e = porArea.get(u.areaId) ?? { cantidad: 0, empresas: new Map<string, number>() };
        e.cantidad += u.cantidad;
        sumarEmpresa(e.empresas, u.product?.empresaId, u.cantidad);
        porArea.set(u.areaId, e);
      }
    }

    const empresasDe = (m: Map<string, number>) =>
      Array.from(m.entries()).map(([empresaId, cantidad]) => ({ empresaId, cantidad }));

    return {
      bodega,
      enTransito,
      pisos: pisos.map((piso) => ({
        ...piso,
        areas: areas
          .filter((a) => a.floorId === piso.id)
          .map((area) => {
            const occ = porArea.get(area.id);
            return { ...area, cantidad: occ?.cantidad ?? 0, empresas: occ ? empresasDe(occ.empresas) : [] };
          }),
        pasillos: pasillos
          .filter((p) => p.floorId === piso.id)
          .map((pasillo) => ({
            ...pasillo,
            zonas: zonas
              .filter((z) => z.aisleId === pasillo.id)
              .map((zona) => ({
                ...zona,
                estantes: estantes
                  .filter((r) => r.zoneId === zona.id)
                  .map((rack) => {
                    const occ = porRack.get(rack.id);
                    return {
                      ...rack,
                      cantidad: occ?.cantidad ?? 0,
                      nivelesOcupados: occ ? occ.niveles.size : 0,
                      ocupacion: rack.niveles > 0 ? (occ ? occ.niveles.size / rack.niveles : 0) : 0,
                      empresas: occ ? empresasDe(occ.empresas) : [],
                    };
                  }),
              })),
          })),
      })),
    };
  }

  /**
   * Detalle de un estante (HU-056): niveles con los productos que contiene
   * (drill-down estante → niveles → productos del mapa 2D).
   */
  async rackDetalle(rackId: string) {
    const rack = await this.dataSource.getRepository(WarehouseRack).findOne({
      where: { id: rackId },
      relations: ['zone', 'zone.aisle', 'zone.aisle.floor'],
    });
    if (!rack) throw new NotFoundException('Estante no encontrado');
    const ubicaciones = await this.locations.find({
      where: { rackId },
      relations: ['product', 'product.empresa'],
    });
    const niveles = Array.from({ length: rack.niveles }, (_, i) => {
      const nivel = i + 1;
      return {
        nivel,
        productos: ubicaciones
          .filter((u) => u.nivel === nivel)
          .map((u) => ({
            ubicacionId: u.id,
            productoId: u.productId,
            codigo: u.product?.codigo,
            descripcion: u.product?.descripcion,
            empresa: u.product?.empresa?.nombre,
            cantidad: u.cantidad,
            esOficial: u.esOficial,
          })),
      };
    });
    return { rack, niveles };
  }

  /**
   * Detalle de un área (bahías/patio): productos almacenados en ella.
   */
  async areaDetalle(areaId: string) {
    const area = await this.dataSource.getRepository(WarehouseArea).findOne({
      where: { id: areaId },
      relations: ['floor'],
    });
    if (!area) throw new NotFoundException('Área no encontrada');
    const ubicaciones = await this.locations.find({
      where: { areaId },
      relations: ['product', 'product.empresa'],
    });
    return {
      area,
      productos: ubicaciones.map((u) => ({
        ubicacionId: u.id,
        productoId: u.productId,
        codigo: u.product?.codigo,
        descripcion: u.product?.descripcion,
        empresa: u.product?.empresa?.nombre,
        cantidad: u.cantidad,
        esOficial: u.esOficial,
      })),
    };
  }

  /**
   * Configura la bodega (asistente). Crea/reemplaza la estructura completa en
   * una transacción. Las áreas fijas del piso 1 (entrada, patio, bahía de
   * empaque, bahía temporal) se generan automáticamente.
   */
  /**
   * Configura la bodega (asistente). Reemplaza la estructura de la bodega
   * activa en una transacción (borra pisos/pasillos/zonas/estantes/áreas y
   * ubicaciones previas). Las áreas fijas del piso 1 se crean solas.
   */
  async configure(dto: ConfigureWarehouseDto, user: { id: string; username: string }) {
    await this.dataSource.transaction(async (m) => {
      // Reconfigurar la bodega activa existente (o crearla si no hay).
      let bodega = await m.getRepository(Warehouse).findOne({ where: { activo: true } });
      if (bodega) {
        // Borrar la estructura previa (cascade en BD).
        const pisos = await m.getRepository(WarehouseFloor).find({ where: { warehouseId: bodega.id } });
        for (const p of pisos) {
          await m.getRepository(WarehouseFloor).delete(p.id);
        }
        bodega.nombre = dto.nombre;
        bodega.forma = dto.forma;
        bodega.anchoM = dto.anchoM;
        bodega.altoM = dto.altoM;
        await m.getRepository(Warehouse).save(bodega);
      } else {
        bodega = await m.getRepository(Warehouse).save(
          m.getRepository(Warehouse).create({
            nombre: dto.nombre,
            forma: dto.forma,
            anchoM: dto.anchoM,
            altoM: dto.altoM,
            activo: true,
          }),
        );
      }

      for (const pisoDto of dto.pisos) {
        const piso = await m.getRepository(WarehouseFloor).save(
          m.getRepository(WarehouseFloor).create({
            warehouseId: bodega.id,
            numero: pisoDto.numero,
            alias: pisoDto.alias ?? `Piso ${pisoDto.numero}`,
            tieneAreasFijas: pisoDto.numero === 1 ? true : pisoDto.tieneAreasFijas,
            activo: true,
          }),
        );

        if (piso.tieneAreasFijas) {
          await this.crearAreasFijas(m, piso.id, dto.anchoM, dto.altoM);
        }

        for (const pasDto of pisoDto.pasillos) {
          const pasillo = await m.getRepository(WarehouseAisle).save(
            m.getRepository(WarehouseAisle).create({
              floorId: piso.id,
              numero: pasDto.numero,
              alias: pasDto.alias ?? `Pasillo ${pasDto.numero}`,
              color: pasDto.color,
              posX: pasDto.posX ?? 0,
              posY: pasDto.posY ?? 0,
              anchoM: pasDto.anchoM ?? 10,
              altoM: pasDto.altoM ?? 4,
              activo: true,
            }),
          );
          for (const zonaDto of pasDto.zonas) {
            const zona = await m.getRepository(WarehouseZone).save(
              m.getRepository(WarehouseZone).create({
                aisleId: pasillo.id,
                lado: zonaDto.lado,
                alias: zonaDto.alias,
                color: zonaDto.color,
                activo: true,
              }),
            );
            // El fondo es un solo espacio: sin estantes.
            if (zonaDto.lado !== ZonaLado.FONDO) {
              for (const estDto of zonaDto.estantes) {
                await m.getRepository(WarehouseRack).save(
                  m.getRepository(WarehouseRack).create({
                    zoneId: zona.id,
                    numero: estDto.numero,
                    alias: estDto.alias ?? `E${estDto.numero}`,
                    niveles: estDto.niveles,
                    activo: true,
                  }),
                );
              }
            }
          }
        }
      }

      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'CONFIGURAR_BODEGA',
          tabla: TABLA,
          registroId: bodega.id,
          valorNuevo: { nombre: dto.nombre, forma: dto.forma, pisos: dto.pisos.length },
        },
        m,
      );
      return bodega;
    });
    // getMapa fuera de la transacción (lee la bodega activa recién configurada).
    return this.getMapa();
  }

  /** Áreas fijas del piso 1: entrada (línea), patio, bahía empaque, bahía temporal. */
  private async crearAreasFijas(m: EntityManager, floorId: string, anchoM: number, altoM: number) {
    const repo = m.getRepository(WarehouseArea);
    const areas: Array<Partial<WarehouseArea>> = [
      // Entrada: línea en el borde inferior (alto 0).
      { tipo: AreaTipo.ENTRADA, alias: 'Entrada', posX: anchoM / 2 - 3, posY: 0, anchoM: 6, altoM: 0, permiteProductos: false },
      { tipo: AreaTipo.PATIO_MANIOBRAS, alias: 'Patio de Maniobras', posX: 2, posY: 1, anchoM: anchoM - 4, altoM: 4, permiteProductos: false },
      { tipo: AreaTipo.BAHIA_EMPAQUE, alias: 'Bahía de Empaque', posX: 2, posY: 6, anchoM: 8, altoM: 4, permiteProductos: true },
      { tipo: AreaTipo.BAHIA_TEMPORAL, alias: 'Bahía Temporal', posX: anchoM - 10, posY: 6, anchoM: 8, altoM: 4, permiteProductos: true },
    ];
    for (const a of areas) {
      await repo.save(repo.create({ ...a, floorId, activo: true } as WarehouseArea));
    }
  }

  /** Mover/redimensionar un cajón (pasillo o área) dentro de la bodega. */
  async moverCajon(tipo: 'pasillo' | 'area', id: string, dto: MoveCajonDto, user: { id: string; username: string }) {
    const repo =
      tipo === 'pasillo'
        ? this.dataSource.getRepository(WarehouseAisle)
        : this.dataSource.getRepository(WarehouseArea);
    const cajon: any = await repo.findOne({ where: { id } as any });
    if (!cajon) throw new NotFoundException('Cajón no encontrado');
    const anterior = { posX: cajon.posX, posY: cajon.posY, anchoM: cajon.anchoM, altoM: cajon.altoM, alias: cajon.alias };
    cajon.posX = dto.posX;
    cajon.posY = dto.posY;
    if (dto.anchoM != null) cajon.anchoM = dto.anchoM;
    if (dto.altoM != null) cajon.altoM = dto.altoM;
    if (dto.alias != null) cajon.alias = dto.alias;
    if (dto.color != null && tipo === 'pasillo') cajon.color = dto.color;
    await (repo.save as any)(cajon);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'MOVER_CAJON',
      tabla: tipo === 'pasillo' ? 'warehouse_aisles' : 'warehouse_areas',
      registroId: id,
      valorAnterior: anterior,
      valorNuevo: { posX: cajon.posX, posY: cajon.posY, anchoM: cajon.anchoM, altoM: cajon.altoM, alias: cajon.alias },
    });
    return cajon;
  }

  /**
   * Asocia un producto a una ubicación (estante/nivel, bahía o tránsito).
   * La ubicación oficial es la de mayor cantidad.
   */
  async assignLocation(dto: AssignLocationDto, user: { id: string; username: string }) {
    const product = await this.dataSource.getRepository(Product).findOne({ where: { id: dto.productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const esTransito = dto.transito === true;
    if (!esTransito && !dto.rackId && !dto.areaId) {
      throw new BadRequestException('Indique rackId+nivel, areaId o transito');
    }
    if (dto.rackId && !dto.nivel) {
      throw new BadRequestException('El nivel es requerido cuando se asigna un estante');
    }
    if (dto.rackId) {
      const rack = await this.dataSource.getRepository(WarehouseRack).findOne({ where: { id: dto.rackId } });
      if (!rack) throw new NotFoundException('Estante no encontrado');
      if (dto.nivel! > rack.niveles) {
        throw new BadRequestException(`El estante tiene ${rack.niveles} niveles`);
      }
    }
    if (dto.areaId) {
      const area = await this.dataSource.getRepository(WarehouseArea).findOne({ where: { id: dto.areaId } });
      if (!area) throw new NotFoundException('Área no encontrada');
      if (!area.permiteProductos) {
        throw new BadRequestException('Esta área no almacena productos');
      }
    }

    const saved = await this.dataSource.transaction(async (m) => {
      const loc = m.getRepository(WarehouseProductLocation).create({
        productId: dto.productId,
        rackId: dto.rackId ?? null,
        nivel: dto.nivel ?? null,
        areaId: dto.areaId ?? null,
        transito: esTransito,
        cantidad: dto.cantidad,
        esOficial: false,
      } as Partial<WarehouseProductLocation>);
      const creado = await m.getRepository(WarehouseProductLocation).save(loc);

      // Recalcular la oficial = la de mayor cantidad del producto.
      const todas = await m.getRepository(WarehouseProductLocation).find({ where: { productId: dto.productId } });
      let max = -1;
      let oficialId: string | null = null;
      for (const t of todas) {
        if (t.cantidad > max) {
          max = t.cantidad;
          oficialId = t.id;
        }
      }
      await m.getRepository(WarehouseProductLocation).update({ productId: dto.productId }, { esOficial: false });
      if (oficialId) {
        await m.getRepository(WarehouseProductLocation).update({ id: oficialId }, { esOficial: true });
      }
      return creado;
    });

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'ASIGNAR_UBICACION',
      tabla: 'warehouse_product_locations',
      registroId: saved.id,
      valorNuevo: { productId: dto.productId, rackId: dto.rackId, nivel: dto.nivel, areaId: dto.areaId, transito: esTransito, cantidad: dto.cantidad },
    });
    return saved;
  }

  /** Ubicaciones de un producto (para la ficha y el mapa). */
  async locationsOfProduct(productId: string) {
    return this.locations.find({ where: { productId }, relations: ['rack', 'rack.zone', 'rack.zone.aisle', 'area'] });
  }

  /**
   * Busca un producto por referencia/código y devuelve sus ubicaciones para
   * resaltarlas en el mapa (ruta básica, HU-059).
   */
  async locateProduct(q: string) {
    const texto = (q || '').trim();
    if (!texto) throw new BadRequestException('q es requerido');
    const product = await this.dataSource.getRepository(Product).findOne({
      where: [{ codigo: texto.toUpperCase() }],
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const ubicaciones = await this.locations.find({
      where: { productId: product.id },
      relations: ['rack', 'rack.zone', 'rack.zone.aisle', 'rack.zone.aisle.floor', 'area'],
    });
    return { product, ubicaciones };
  }
}
