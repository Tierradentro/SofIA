import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ImportJob, ImportJobStatus } from './entities/import-job.entity';
import { ImportParserService } from './import-parser.service';
import { ImportValidatorService, FilaValidada } from './import-validator.service';
import { ImportType } from '../../common/enums/import-type.enum';
import { CreateImportDto } from './dto/create-import.dto';
import { AuditService } from '../audit/audit.service';
import { MovementsService } from '../movements/movements.service';
import { Product } from '../products/entities/product.entity';
import { Client } from '../clients/entities/client.entity';
import { ClientAddress } from '../clients/entities/client-address.entity';
import { MAX_DIRECCIONES_CLIENTE } from '../clients/clients.service';
import {
  claveDireccion,
  direccionDuplicada,
} from '../../common/utils/normalizar-direccion';
import { Comercial } from '../comerciales/entities/comercial.entity';
import { ProductStatus } from '../../common/enums/product-status.enum';
import { MovementType } from '../../common/enums/movement-type.enum';
import { UploadedFilePayload } from '../documents/documents.service';

const TABLA = 'import_jobs';
const TIPOS_POR_EMPRESA = [ImportType.PRODUCTOS, ImportType.CANTIDADES];

/**
 * Campo destino de importación (snake_case, M18) → propiedad de Product.
 * Sin este mapeo, repo.create()/Object.assign() descartan en silencio las
 * llaves que no coinciden con propiedades de la entidad (codigo_oe, etc.).
 */
const CAMPO_A_PROPIEDAD_PRODUCTO: Record<string, keyof Product> = {
  descripcion: 'descripcion',
  proveedor: 'proveedor',
  marca: 'marca',
  vehiculo: 'vehiculo',
  categoria: 'categoria',
  subcategoria: 'subcategoria',
  observaciones: 'observaciones',
  aplicacion: 'aplicacion',
  codigo_oe: 'codigoOE',
  ref_cruzada_1: 'refCruzada1',
  ref_cruzada_2: 'refCruzada2',
  unidad_medida: 'unidadMedida',
  precio: 'precio',
  link_imagen: 'linkImagen',
  ubicacion: 'ubicacion',
  grupo_siete: 'grupoSiete',
  grupo_ocho: 'grupoOcho',
};

/**
 * M18: importación desde la maestra contable.
 *  - PRODUCTOS (HU-010): nuevos → crea; existentes (mismo código, misma
 *    empresa) → actualiza atributos; resumen con diferencias (HU-016).
 *  - CANTIDADES: genera movimientos AJUSTE_IMPORTACION por diferencia,
 *    SOLO tras aprobación del Administrador (M18). Nunca sobrescritura.
 *  - CLIENTES / COMERCIALES: catálogos globales; crea nuevos, actualiza
 *    existentes por identificación (o nombre si no hay identificación).
 */
@Injectable()
export class ImportsService {
  constructor(
    @InjectRepository(ImportJob) private readonly jobs: Repository<ImportJob>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly parser: ImportParserService,
    private readonly validator: ImportValidatorService,
    private readonly audit: AuditService,
    private readonly movements: MovementsService,
  ) {}

  /** Carga y valida el archivo (HU-016). El resumen queda en el job. */
  async upload(
    dto: CreateImportDto,
    file: UploadedFilePayload,
    user: { id: string; username: string },
  ) {
    if (!file) throw new BadRequestException('Archivo requerido');
    if (TIPOS_POR_EMPRESA.includes(dto.tipo) && !dto.empresaId) {
      throw new BadRequestException(
        `La empresa es obligatoria para importaciones de ${dto.tipo}`,
      );
    }

    const parsed = this.parser.parse(file.buffer, file.originalname);
    const resultado = this.validator.validar(
      dto.tipo,
      parsed.columnas,
      parsed.filas,
      dto.mapeo,
    );

    // Resumen con diferencias contra la BD (HU-016)
    const resumen = await this.buildResumen(dto, resultado.validas);

    const job = await this.jobs.save(
      this.jobs.create({
        tipo: dto.tipo,
        empresaId: dto.empresaId ?? null,
        nombreArchivo: file.originalname,
        mapeo: dto.mapeo,
        estado: ImportJobStatus.PENDIENTE_APROBACION,
        createdBy: user.id,
        resumen: {
          totalFilas: parsed.filas.length,
          validas: resultado.validas.length,
          invalidas: resultado.invalidas.map((f) => ({
            fila: f.numeroFila,
            errores: f.errores,
          })),
          duplicados: resultado.duplicados,
          columnas: parsed.columnas,
          ...resumen,
          filasValidas: resultado.validas,
        },
      }),
    );

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'IMPORTACION_CARGA',
      tabla: TABLA,
      registroId: job.id,
      valorNuevo: {
        tipo: dto.tipo,
        empresaId: dto.empresaId,
        archivo: file.originalname,
        validas: resultado.validas.length,
        invalidas: resultado.invalidas.length,
      },
    });
    return this.toResponse(job);
  }

  /** HU-016: resumen previo a la aprobación. */
  async getResumen(id: string) {
    const job = await this.findJob(id);
    return this.toResponse(job);
  }

  async findAll(tipo?: ImportType) {
    const where = tipo ? { tipo } : {};
    const jobs = await this.jobs.find({ where, order: { createdAt: 'DESC' }, take: 100 });
    return jobs.map((j) => this.toResponse(j, false));
  }

  /**
   * Aprobación (M18):
   *  - CANTIDADES: solo el Administrador; genera movimientos AJUSTE_IMPORTACION
   *    por las diferencias en una única transacción.
   *  - PRODUCTOS / CLIENTES / COMERCIALES: el rol que cargó (Generador) o
   *    Administrador; crea/actualiza registros.
   */
  async approve(id: string, user: { id: string; username: string; rol: string }) {
    const job = await this.findJob(id);
    if (job.estado !== ImportJobStatus.PENDIENTE_APROBACION) {
      throw new BadRequestException(
        `La importación está en estado ${job.estado}; no se puede aprobar`,
      );
    }
    if (job.tipo === ImportType.CANTIDADES && user.rol !== 'ADMINISTRADOR') {
      throw new BadRequestException(
        'La importación de cantidades requiere aprobación del Administrador',
      );
    }
    const filas = (job.resumen as any)?.filasValidas as FilaValidada[];
    if (!filas || filas.length === 0) {
      throw new BadRequestException('No hay filas válidas para aplicar');
    }

    let aplicado: Record<string, number>;
    switch (job.tipo) {
      case ImportType.PRODUCTOS:
        aplicado = await this.aplicarProductos(job, filas, user);
        break;
      case ImportType.CANTIDADES:
        aplicado = await this.aplicarCantidades(job, filas, user);
        break;
      case ImportType.CLIENTES:
        aplicado = await this.aplicarClientesConDirecciones(filas);
        break;
      case ImportType.COMERCIALES:
        aplicado = await this.aplicarCatalogo(filas, Comercial);
        break;
    }

    job.estado = ImportJobStatus.APLICADO;
    job.aprobadoPor = user.id;
    job.resumen = { ...(job.resumen as any), aplicado };
    await this.jobs.save(job);

    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'IMPORTACION_APROBADA',
      tabla: TABLA,
      registroId: job.id,
      valorNuevo: aplicado,
    });
    return this.toResponse(job);
  }

  async reject(id: string, user: { id: string; username: string }, motivo?: string) {
    const job = await this.findJob(id);
    if (job.estado !== ImportJobStatus.PENDIENTE_APROBACION) {
      throw new BadRequestException(
        `La importación está en estado ${job.estado}; no se puede rechazar`,
      );
    }
    job.estado = ImportJobStatus.RECHAZADO;
    await this.jobs.save(job);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'IMPORTACION_RECHAZADA',
      tabla: TABLA,
      registroId: job.id,
      motivo: motivo ?? null,
    });
    return this.toResponse(job);
  }

  // ---------------------------------------------------------------------

  /** HU-016: diferencias contra BD antes de aplicar. */
  private async buildResumen(dto: CreateImportDto, validas: FilaValidada[]) {
    if (dto.tipo === ImportType.PRODUCTOS) {
      const codigos = validas.map((f) => f.datos.codigo);
      const existentes = await this.dataSource.getRepository(Product).find({
        where: { empresaId: dto.empresaId },
      });
      const set = new Set(existentes.map((p) => p.codigo));
      return {
        nuevos: validas.filter((f) => !set.has(f.datos.codigo)).length,
        actualizados: validas.filter((f) => set.has(f.datos.codigo)).length,
        codigosMuestra: codigos.slice(0, 10),
      };
    }
    if (dto.tipo === ImportType.CANTIDADES) {
      const productos = await this.dataSource.getRepository(Product).find({
        where: { empresaId: dto.empresaId },
      });
      const map = new Map(productos.map((p) => [p.codigo, p.cantidad]));
      const diferencias = validas
        .map((f) => {
          const actual = map.get(f.datos.codigo);
          const nueva = Number(f.datos.cantidad);
          return actual === undefined
            ? { codigo: f.datos.codigo, estado: 'PRODUCTO_NO_EXISTE' }
            : { codigo: f.datos.codigo, actual, nueva, diferencia: nueva - actual };
        })
        .filter((d: any) => d.estado === 'PRODUCTO_NO_EXISTE' || d.diferencia !== 0);
      return {
        conDiferencia: diferencias.filter((d: any) => d.diferencia !== undefined).length,
        productosNoExistentes: diferencias
          .filter((d: any) => d.estado === 'PRODUCTO_NO_EXISTE')
          .map((d: any) => d.codigo),
        diferencias: diferencias.filter((d: any) => d.diferencia !== undefined).slice(0, 50),
      };
    }
    if (dto.tipo === ImportType.CLIENTES) {
      // I18: estimación previa con la misma regla de aplicación — una fila
      // por dirección; cliente+dirección existentes se descartan.
      // I20: misma normalización (abreviaturas/puntuación/similitud) y
      // mismo tope de 10 direcciones que el paso real de aprobación.
      const repoClientes = this.dataSource.getRepository(Client);
      const repoDirs = this.dataSource.getRepository(ClientAddress);
      let nuevos = 0;
      let direccionesAAgregar = 0;
      let descartados = 0;
      let omitidasMaximo = 0;
      const nuevosEnLote = new Map<string, Set<string>>();
      const dirsCache = new Map<string, Set<string>>();
      for (const f of validas) {
        const limpio = Object.fromEntries(
          Object.entries(f.datos).filter(([, v]) => v !== ''),
        );
        const claveNuevo = (limpio.identificacion || limpio.nombre || '')
          .trim()
          .toLowerCase();
        const existente = limpio.identificacion
          ? await repoClientes.findOne({
              where: { identificacion: limpio.identificacion },
            })
          : await repoClientes.findOne({ where: { nombre: limpio.nombre } });
        if (!existente && !nuevosEnLote.has(claveNuevo)) {
          nuevos++;
          nuevosEnLote.set(
            claveNuevo,
            new Set(limpio.direccion ? [claveDireccion(limpio.direccion, limpio.ciudad)] : []),
          );
          continue;
        }
        const direccion = limpio.direccion?.trim();
        if (!direccion) {
          descartados++;
          continue;
        }
        let conocidas: Set<string>;
        if (existente) {
          if (!dirsCache.has(existente.id)) {
            const actuales = await repoDirs.find({
              where: { clientId: existente.id, activo: true },
            });
            dirsCache.set(
              existente.id,
              new Set(actuales.map((a) => claveDireccion(a.direccion, a.ciudad))),
            );
          }
          conocidas = dirsCache.get(existente.id)!;
        } else {
          conocidas = nuevosEnLote.get(claveNuevo)!;
        }
        if (direccionDuplicada(direccion, limpio.ciudad, conocidas)) {
          descartados++;
        } else if (conocidas.size >= MAX_DIRECCIONES_CLIENTE) {
          // I20: el preview también aplica el tope — antes podía mostrar
          // "se agregará" una fila que al aprobar quedaría omitida.
          omitidasMaximo++;
        } else {
          conocidas.add(claveDireccion(direccion, limpio.ciudad));
          direccionesAAgregar++;
        }
      }
      return { nuevos, direccionesAAgregar, descartados, omitidasMaximo };
    }
    // COMERCIALES
    return { nuevos: validas.length, actualizados: 0 };
  }

  /**
   * Aplica las filas válidas en una ÚNICA transacción (QA Func. 1.1): si algo
   * falla a mitad de camino no quedan productos parcialmente aplicados.
   * Las filas inválidas ya fueron excluidas en la validación (mejor esfuerzo)
   * y se reportan en el resumen del job.
   * La auditoría se escribe con el mismo EntityManager (misma conexión).
   */
  private async aplicarProductos(
    job: ImportJob,
    filas: FilaValidada[],
    user: { id: string; username: string },
  ) {
    let nuevos = 0;
    let actualizados = 0;

    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(Product);
      const existentes = await repo.find({ where: { empresaId: job.empresaId! } });
      const map = new Map(existentes.map((p) => [p.codigo, p]));

      for (const fila of filas) {
        const { codigo, ...datos } = fila.datos;
        // Mapeo explícito snake_case (destino de importación) → propiedad de la
        // entidad; sin esto, campos como codigo_oe se descartaban en silencio.
        const limpio: Record<string, any> = {};
        for (const [campo, valor] of Object.entries(datos)) {
          if (valor === '') continue;
          const propiedad = CAMPO_A_PROPIEDAD_PRODUCTO[campo];
          if (propiedad) limpio[propiedad] = valor;
        }
        const existente = map.get(codigo);
        if (existente) {
          const anterior = { ...existente };
          Object.assign(existente, limpio, {
            precio: limpio.precio !== undefined ? Number(limpio.precio) : existente.precio,
          });
          await repo.save(existente);
          actualizados++;
          await this.audit.log(
            {
              usuarioId: user.id,
              usuarioUsername: user.username,
              accion: 'EDITAR',
              tabla: 'Productos',
              registroId: existente.id,
              valorAnterior: anterior as any,
              valorNuevo: existente as any,
              motivo: `Importación contable ${job.nombreArchivo}`,
            },
            em,
          );
        } else {
          const producto = await repo.save(
            repo.create({
              ...limpio,
              codigo,
              empresaId: job.empresaId!,
              precio: limpio.precio !== undefined ? Number(limpio.precio) : 0,
              cantidad: 0,
              cantidadBloqueada: 0,
              estado: ProductStatus.ACTIVO,
            }),
          );
          nuevos++;
          map.set(codigo, producto);
          await this.audit.log(
            {
              usuarioId: user.id,
              usuarioUsername: user.username,
              accion: 'CREAR',
              tabla: 'Productos',
              registroId: producto.id,
              valorNuevo: producto as any,
              motivo: `Importación contable ${job.nombreArchivo}`,
            },
            em,
          );
        }
      }
    });
    return { nuevos, actualizados };
  }

  /**
   * M18: las cantidades se ajustan por MOVIMIENTOS, nunca por sobrescritura.
   * Una única transacción para todos los productos del archivo.
   */
  private async aplicarCantidades(
    job: ImportJob,
    filas: FilaValidada[],
    user: { id: string; username: string },
  ) {
    const repo = this.dataSource.getRepository(Product);
    const productos = await repo.find({ where: { empresaId: job.empresaId! } });
    const map = new Map(productos.map((p) => [p.codigo, p]));
    let ajustes = 0;
    const omitidos: string[] = [];

    await this.dataSource.transaction(async (em) => {
      for (const fila of filas) {
        const producto = map.get(fila.datos.codigo);
        if (!producto) {
          omitidos.push(fila.datos.codigo);
          continue;
        }
        const nueva = Number(fila.datos.cantidad);
        const delta = nueva - producto.cantidad;
        if (delta === 0) continue;
        await this.movements.apply(
          {
            productId: producto.id,
            tipo: MovementType.AJUSTE_IMPORTACION,
            cantidadDelta: delta,
            docTipo: 'IMPORTACION',
            docId: job.id,
            usuarioId: user.id,
          },
          em,
        );
        producto.cantidad = nueva; // reflejar para el siguiente cálculo del mismo código
        ajustes++;
      }
    });

    // Auditoría de la entidad Productos por cada ajuste (trazabilidad)
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'AJUSTE_IMPORTACION',
      tabla: 'Productos',
      registroId: null,
      valorNuevo: { ajustes, omitidos, importacion: job.id },
      motivo: `Ajuste de cantidades por importación ${job.nombreArchivo}`,
    });
    return { ajustes, omitidos: omitidos.length };
  }

  private async aplicarCatalogo(
    filas: FilaValidada[],
    entity: typeof Comercial,
  ) {
    let nuevos = 0;
    let actualizados = 0;
    // Única transacción por lote (QA Func. 1.1): sin aplicados parciales.
    await this.dataSource.transaction(async (em) => {
      const repo = em.getRepository(entity as any) as Repository<any>;
      for (const fila of filas) {
        const limpio = Object.fromEntries(
          Object.entries(fila.datos).filter(([, v]) => v !== ''),
        );
        const existente = limpio.identificacion
          ? await repo.findOne({ where: { identificacion: limpio.identificacion } })
          : await repo.findOne({ where: { nombre: limpio.nombre } });
        if (existente) {
          Object.assign(existente, limpio);
          await repo.save(existente);
          actualizados++;
        } else {
          await repo.save(repo.create(limpio));
          nuevos++;
        }
      }
    });
    return { nuevos, actualizados };
  }

  /**
   * I18 — CLIENTES: la maestra contable trae una fila por dirección; un
   * cliente repetido no es duplicado a descartar, es otra dirección suya.
   *  - Cliente nuevo            → se crea; su dirección queda principal.
   *  - Cliente existe + dirección nueva → se agrega a client_addresses
   *    (máx. 10, QA Func. 4.1; si no tenía ninguna, queda principal).
   *  - Cliente existe + dirección ya registrada → la fila se descarta.
   * Los datos del cliente existente ya no se sobrescriben: la fila solo
   * aporta direcciones. Todo en la transacción única del lote (QA Func. 1.1).
   */
  private async aplicarClientesConDirecciones(filas: FilaValidada[]) {
    let nuevos = 0;
    let direccionesAgregadas = 0;
    let descartados = 0;
    let omitidasMaximo = 0;

    await this.dataSource.transaction(async (em) => {
      const repoClientes = em.getRepository(Client);
      const repoDirs = em.getRepository(ClientAddress);
      // Cachés del lote: evitan duplicar direcciones cuando el mismo
      // cliente aparece varias veces en el archivo.
      const dirsPorCliente = new Map<string, Set<string>>();

      const dirsConocidas = async (clienteId: string) => {
        if (!dirsPorCliente.has(clienteId)) {
          const actuales = await repoDirs.find({
            where: { clientId: clienteId, activo: true },
          });
          dirsPorCliente.set(
            clienteId,
            new Set(actuales.map((a) => claveDireccion(a.direccion, a.ciudad))),
          );
        }
        return dirsPorCliente.get(clienteId)!;
      };

      for (const fila of filas) {
        const limpio = Object.fromEntries(
          Object.entries(fila.datos).filter(([, v]) => v !== ''),
        );
        const direccion = limpio.direccion?.trim();
        const ciudad = limpio.ciudad?.trim() || null;

        let cliente = limpio.identificacion
          ? await repoClientes.findOne({
              where: { identificacion: limpio.identificacion },
            })
          : await repoClientes.findOne({ where: { nombre: limpio.nombre } });

        if (!cliente) {
          cliente = await repoClientes.save(repoClientes.create(limpio));
          nuevos++;
          if (direccion) {
            await repoDirs.save(
              repoDirs.create({
                clientId: cliente.id,
                direccion,
                ciudad,
                esPrincipal: true,
              }),
            );
            (await dirsConocidas(cliente.id)).add(claveDireccion(direccion, ciudad));
          }
          continue;
        }

        // Cliente existente: la fila solo puede aportar una dirección nueva.
        if (!direccion) {
          descartados++;
          continue;
        }
        const conocidas = await dirsConocidas(cliente.id);
        // I20: casi-duplicados (abreviatura, puntuación, tipeo) también descartan
        if (direccionDuplicada(direccion, ciudad, conocidas)) {
          descartados++;
          continue;
        }
        if (conocidas.size >= MAX_DIRECCIONES_CLIENTE) {
          omitidasMaximo++;
          continue;
        }
        await repoDirs.save(
          repoDirs.create({
            clientId: cliente.id,
            direccion,
            ciudad,
            esPrincipal: conocidas.size === 0,
          }),
        );
        conocidas.add(claveDireccion(direccion, ciudad));
        direccionesAgregadas++;
      }
    });
    return { nuevos, direccionesAgregadas, descartados, omitidasMaximo };
  }

  private async findJob(id: string): Promise<ImportJob> {
    const job = await this.jobs.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Importación no encontrada');
    return job;
  }

  private toResponse(job: ImportJob, incluirFilas = true) {
    const { resumen, ...rest } = job as any;
    const r = resumen ? { ...resumen } : null;
    if (r && !incluirFilas) delete r.filasValidas;
    return { ...rest, resumen: r };
  }
}
