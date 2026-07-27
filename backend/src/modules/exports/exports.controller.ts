import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { AuditModule } from '../audit/audit.module';
import { Module } from '@nestjs/common';

const COLUMNAS = [
  'codigo', 'descripcion', 'proveedor', 'marca', 'vehiculo', 'categoria',
  'subcategoria', 'codigo_oe', 'ref_cruzada_1', 'ref_cruzada_2',
  'unidad_medida', 'cantidad', 'cantidad_bloqueada', 'precio', 'estado',
  'ubicacion', 'grupo_siete', 'grupo_ocho',
];

function csvEscape(v: any): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * HU-017 / M12 Exportación: CSV UTF-8 por empresa con los campos del
 * producto, cantidades, bloqueadas y ajustes (movimientos) — el reporte
 * mantiene trazabilidad a la empresa.
 */
@Controller('exports')
@Roles(Role.GENERADOR, Role.ADMINISTRADOR)
export class ExportsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Get('products.csv')
  async productsCsv(
    @Query('empresaId') empresaId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    if (!empresaId) throw new BadRequestException('empresaId es requerido');
    const empresa = await this.dataSource
      .getRepository('companies')
      .findOne({ where: { id: empresaId } }) as any;
    if (!empresa) throw new BadRequestException('Empresa no encontrada');

    const productos = await this.dataSource.query(
      `SELECT ${COLUMNAS.map((c) => `"${c}"`).join(', ')}
       FROM products WHERE empresa_id = $1 ORDER BY codigo`,
      [empresaId],
    );

    // Trazabilidad: los ajustes (movimientos) de la empresa, para auditoría
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'EXPORTACION_CSV',
      tabla: 'Productos',
      registroId: null,
      valorNuevo: { empresa: empresa.nombre, registros: productos.length },
    });

    const lineas = [
      `empresa,${COLUMNAS.join(',')}`,
      ...productos.map(
        (p: any) =>
          `${csvEscape(empresa.nombre)},${COLUMNAS.map((c) => csvEscape(p[c])).join(',')}`,
      ),
    ];
    const csv = '﻿' + lineas.join('\n'); // BOM para Excel (UTF-8)

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="productos-${empresa.siglas}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }

  /** B-6 (spec §11): pedidos con empresa, cliente, comercial y totales. */
  @Get('pedidos.csv')
  async pedidosCsv(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const rows: any[] = await this.dataSource.query(
      `SELECT o.numero, c.nombre AS empresa, cl.nombre AS cliente,
              co.nombre AS comercial, o.estado, o.ciudad, o.orden_pedido,
              o.created_via, o.created_at,
              (SELECT count(*) FROM order_items oi WHERE oi.order_id = o.id) AS lineas,
              (SELECT COALESCE(sum(oi.valor_total),0) FROM order_items oi WHERE oi.order_id = o.id) AS valor_total
       FROM orders o
       JOIN companies c ON c.id = o.empresa_id
       JOIN clients cl ON cl.id = o.cliente_id
       LEFT JOIN comerciales co ON co.id = o.comercial_id
       ORDER BY o.created_at DESC`,
    );
    await this.auditExport(user, 'Pedidos', rows.length);
    this.sendCsv(
      res,
      'pedidos',
      ['numero','empresa','cliente','comercial','estado','ciudad','orden_pedido','created_via','created_at','lineas','valor_total'],
      rows,
    );
  }

  /** B-6 (spec §11): despachos (globales, B-1) con empresas por ítem y transporte. */
  @Get('despachos.csv')
  async despachosCsv(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const rows: any[] = await this.dataSource.query(
      `SELECT d.numero, cl.nombre AS cliente, d.estado,
              (SELECT string_agg(DISTINCT c.nombre, ' | ')
                 FROM dispatch_orders do2 JOIN companies c ON c.id = do2.empresa_id
                WHERE do2.dispatch_id = d.id) AS empresas,
              (SELECT count(*) FROM boxes b WHERE b.dispatch_id = d.id) AS cajas,
              d.tipo_transporte, d.nombre_transporte, d.guia, d.fecha_salida,
              d.created_at
       FROM dispatches d
       JOIN clients cl ON cl.id = d.cliente_id
       ORDER BY d.created_at DESC`,
    );
    await this.auditExport(user, 'Despachos', rows.length);
    this.sendCsv(
      res,
      'despachos',
      ['numero','cliente','estado','empresas','cajas','tipo_transporte','nombre_transporte','guia','fecha_salida','created_at'],
      rows,
    );
  }

  /** B-6 (spec §11): trazabilidad cliente → pedidos → despachos. */
  @Get('cliente-pedidos-despachos.csv')
  async clientePedidosDespachosCsv(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const rows: any[] = await this.dataSource.query(
      `SELECT cl.nombre AS cliente, o.numero AS pedido, o.estado AS estado_pedido,
              o.numero_factura, d.numero AS despacho, d.estado AS estado_despacho,
              d.guia, o.created_at AS pedido_creado
       FROM orders o
       JOIN clients cl ON cl.id = o.cliente_id
       LEFT JOIN dispatch_orders do2 ON do2.order_id = o.id
       LEFT JOIN dispatches d ON d.id = do2.dispatch_id
       ORDER BY cl.nombre, o.created_at DESC`,
    );
    await this.auditExport(user, 'Cliente-Pedidos-Despachos', rows.length);
    this.sendCsv(
      res,
      'cliente-pedidos-despachos',
      ['cliente','pedido','estado_pedido','numero_factura','despacho','estado_despacho','guia','pedido_creado'],
      rows,
    );
  }

  /** B-6 + HU-051 (spec §11): actividades de inventarios con diferencias. */
  @Get('inventarios.csv')
  async inventariosCsv(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const rows: any[] = await this.dataSource.query(
      `SELECT sc.numero, c.nombre AS empresa, sc.estado,
              p.codigo AS producto, i.existencia_snapshot, i.conteo,
              (i.conteo - i.existencia_snapshot) AS diferencia,
              ((i.conteo - i.existencia_snapshot) * i.precio_snapshot) AS valor_estimado,
              i.ubicacion, sc.cerrado_por, sc.aprobado_por, sc.created_at, sc.aprobado_at
       FROM stock_counts sc
       JOIN companies c ON c.id = sc.empresa_id
       LEFT JOIN stock_count_items i ON i.count_id = sc.id
       LEFT JOIN products p ON p.id = i.product_id
       ORDER BY sc.created_at DESC, p.codigo`,
    );
    await this.auditExport(user, 'Inventarios', rows.length);
    this.sendCsv(
      res,
      'inventarios',
      ['numero','empresa','estado','producto','existencia_snapshot','conteo','diferencia','valor_estimado','ubicacion','cerrado_por','aprobado_por','created_at','aprobado_at'],
      rows,
    );
  }

  private async auditExport(user: AuthenticatedUser, reporte: string, registros: number) {
    await this.audit.log({
      usuarioId: user.id,
      usuarioUsername: user.username,
      accion: 'EXPORTACION_CSV',
      tabla: reporte,
      registroId: null,
      valorNuevo: { reporte, registros },
    });
  }

  private sendCsv(
    res: Response,
    nombre: string,
    columnas: string[],
    rows: any[],
  ) {
    const lineas = [
      columnas.join(','),
      ...rows.map((r) => columnas.map((c) => csvEscape(r[c])).join(',')),
    ];
    const csv = '﻿' + lineas.join('\n'); // BOM para Excel (UTF-8)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nombre}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    res.send(csv);
  }
}

@Module({
  imports: [AuditModule],
  controllers: [ExportsController],
})
export class ExportsModule {}
