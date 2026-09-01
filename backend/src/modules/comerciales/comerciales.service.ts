import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, ILike, Repository } from 'typeorm';
import { Comercial } from './entities/comercial.entity';
import { CreateComercialDto, UpdateComercialDto } from './dto/comercial.dto';
import { AuditService } from '../audit/audit.service';

const TABLA = 'comerciales';

@Injectable()
export class ComercialesService {
  constructor(
    @InjectRepository(Comercial)
    private readonly comerciales: Repository<Comercial>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateComercialDto, user: { id: string; username: string }) {
    const comercial = await this.comerciales.save(this.comerciales.create(dto));
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'CREAR',
      tabla: TABLA,
      registroId: comercial.id,
      valorNuevo: comercial as any,
    });
    return comercial;
  }

  findAll(q?: string) {
    return this.comerciales.find({
      where: q
        ? [
            { nombre: ILike(`%${q}%`), activo: true },
            { identificacion: ILike(`%${q}%`), activo: true },
          ]
        : { activo: true },
      order: { nombre: 'ASC' },
      take: 100,
    });
  }

  /**
   * I31: variante acotada para la API externa (página limitada explícita,
   * alineada con el tope de clientes).
   */
  findAllPaginado(q?: string, take = 50) {
    return this.comerciales.find({
      where: q
        ? [
            { nombre: ILike(`%${q}%`), activo: true },
            { identificacion: ILike(`%${q}%`), activo: true },
          ]
        : { activo: true },
      order: { nombre: 'ASC' },
      take,
    });
  }

  async findOne(id: string) {
    const comercial = await this.comerciales.findOne({ where: { id } });
    if (!comercial) throw new NotFoundException('Comercial no encontrado');
    return comercial;
  }

  /**
   * I35: actividad asociada al comercial — pedidos, despachos y devoluciones
   * (casos PQRS) registrados a su nombre, con totales y los más recientes.
   */
  async resumen(id: string) {
    const comercial = await this.findOne(id);
    const pedidos = await this.dataSource.query(
      `SELECT o.id, o.numero, o.estado, o.ciudad,
              o.numero_factura AS "numeroFactura", o.created_at,
              (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS items
       FROM orders o
       WHERE o.comercial_id = $1
       ORDER BY o.created_at DESC
       LIMIT 20`,
      [id],
    );
    const [{ total: totalPedidos }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM orders WHERE comercial_id = $1`,
      [id],
    );
    const despachos = await this.dataSource.query(
      `SELECT d.id, d.estado, d.guia, d.created_at
       FROM dispatches d
       WHERE d.id IN (
         SELECT do2.dispatch_id
         FROM dispatch_orders do2 JOIN orders o2 ON o2.id = do2.order_id
         WHERE o2.comercial_id = $1
       )
       ORDER BY d.created_at DESC
       LIMIT 20`,
      [id],
    );
    const [{ total: totalDespachos }] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT do2.dispatch_id)::int AS total
       FROM dispatch_orders do2 JOIN orders o2 ON o2.id = do2.order_id
       WHERE o2.comercial_id = $1`,
      [id],
    );
    const devoluciones = await this.dataSource.query(
      `SELECT p.id, p.codigo, p.cantidad, p.estado, p.motivo_codigo AS "motivoCodigo",
              p.factura, p.created_at
       FROM pqrs_cases p
       WHERE p.comercial_id = $1
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [id],
    );
    const [{ total: totalDevoluciones }] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS total FROM pqrs_cases WHERE comercial_id = $1`,
      [id],
    );
    return {
      comercial,
      pedidos: { total: totalPedidos, recientes: pedidos },
      despachos: { total: totalDespachos, recientes: despachos },
      devoluciones: { total: totalDevoluciones, recientes: devoluciones },
    };
  }

  async update(id: string, dto: UpdateComercialDto, user: { id: string; username: string }) {
    const comercial = await this.findOne(id);
    const anterior = { ...comercial };
    Object.assign(comercial, dto);
    const saved = await this.comerciales.save(comercial);
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'EDITAR',
      tabla: TABLA,
      registroId: id,
      valorAnterior: anterior as any,
      valorNuevo: saved as any,
    });
    return saved;
  }
}
