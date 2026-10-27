import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuditService } from '../audit/audit.service';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { AuditModule } from '../audit/audit.module';
import { Module } from '@nestjs/common';
import {
  WO_CONSECUTIVO_PREFIX,
  WoConfig,
  WoPedidoInput,
  construirXlsxWo,
  validarExportacionWo,
  woClaveConfig,
} from './world-office';

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
@Roles(Role.GENERADOR, Role.ADMINISTRADOR, Role.OPERADOR)
export class ExportsController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
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
      `SELECT id, ${COLUMNAS.map((c) => `"${c}"`).join(', ')}
       FROM products WHERE empresa_id = $1 ORDER BY codigo`,
      [empresaId],
    );

    // I34: ubicación oficial legible (Grupo 7 de la exportación contable) en
    // un solo campo: P{piso}-A{pasillo}-{lado}-{estante}-N{nivel} | AREA-* | TRANSITO.
    // I40: el fondo del pasillo cuelga de la zona directamente (sin estante):
    // P{piso}-A{pasillo}-FONDO.
    const oficiales: any[] = await this.dataSource.query(
      `SELECT wpl.product_id,
              f.numero  AS piso,
              a.numero  AS pasillo,
              z.lado    AS lado,
              r.alias   AS estante,
              wpl.nivel AS nivel,
              ar.tipo   AS area_tipo,
              wpl.transito AS transito,
              (wpl.zone_id IS NOT NULL AND wpl.rack_id IS NULL) AS fondo
       FROM warehouse_product_locations wpl
       LEFT JOIN warehouse_racks   r  ON r.id  = wpl.rack_id
       LEFT JOIN warehouse_zones   z  ON z.id  = COALESCE(r.zone_id, wpl.zone_id)
       LEFT JOIN warehouse_aisles  a  ON a.id  = z.aisle_id
       LEFT JOIN warehouse_floors  f  ON f.id  = a.floor_id
       LEFT JOIN warehouse_areas   ar ON ar.id = wpl.area_id
       WHERE wpl.es_oficial = true
         AND wpl.product_id IN (SELECT id FROM products WHERE empresa_id = $1)`,
      [empresaId],
    );
    const codigoPorProducto = new Map<string, string>();
    for (const o of oficiales) {
      let codigo: string | null = null;
      if (o.transito) codigo = 'TRANSITO';
      else if (o.area_tipo) codigo = `AREA-${o.area_tipo}`;
      else if (o.fondo) codigo = `P${o.piso ?? 1}-A${o.pasillo ?? 0}-FONDO`;
      else if (o.estante) codigo = `P${o.piso ?? 1}-A${o.pasillo ?? 0}-${(o.lado ?? '').slice(0, 1)}-${o.estante}-N${o.nivel ?? 1}`;
      if (codigo) codigoPorProducto.set(o.product_id, codigo);
    }
    for (const p of productos) {
      const oficial = codigoPorProducto.get(p.id as string);
      if (oficial) p.grupo_siete = oficial;
    }

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
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
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
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
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
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
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
  @Roles(Role.GENERADOR, Role.ADMINISTRADOR)
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

  /**
   * I51: pre-validación de la exportación a World Office. Retorna errores
   * bloqueantes y advertencias por pedido; el frontend la usa en el modal
   * previo a la descarga.
   */
  @Post('world-office/preflight')
  async woPreflight(@Body() body: { orderIds?: string[] }) {
    const ctx = await this.cargarContextoWo(body?.orderIds);
    return validarExportacionWo(ctx);
  }

  /**
   * I51: genera el CSV de 57 columnas para el Asistente de Importación de
   * World Office. Asigna a cada pedido el consecutivo WO de la empresa,
   * marca los pedidos (exportado_wo, número y lote) y audita la exportación.
   * Sin BOM: se replica el archivo validado como exitoso en WO.
   */
  @Post('world-office/pedidos.xlsx')
  async woPedidosCsv(
    @Body() body: { orderIds?: string[] },
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const ctx = await this.cargarContextoWo(body?.orderIds);
    const pre = validarExportacionWo(ctx);
    if (!pre.ok) {
      throw new BadRequestException({
        code: 'WO_PREFLIGHT_ERRORES',
        message: 'Hay errores que bloquean la exportación a World Office',
        ...pre,
      });
    }

    const lote = randomUUID();
    // Asignación del consecutivo y marcado de pedidos en una sola
    // transacción con bloqueo de la fila del parámetro (evita duplicados
    // si dos usuarios exportan a la vez).
    const numerosWo = await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `SELECT valor FROM system_params WHERE clave = $1 FOR UPDATE`,
        [ctx.claveConsecutivo],
      );
      const actual = Number(rows[0]?.valor?.consecutivoActual ?? 0);
      // Idempotencia: un pedido ya exportado conserva su número WO; solo los
      // pedidos nuevos consumen consecutivo.
      let siguiente = actual + 1;
      const numeros = new Map<string, number>();
      for (const p of ctx.pedidos) {
        if (p.exportadoWo && p.woDocumentoNumero) {
          numeros.set(p.id, p.woDocumentoNumero);
        } else {
          numeros.set(p.id, siguiente++);
        }
      }
      await manager.query(
        `UPDATE system_params
         SET valor = jsonb_set(valor, '{consecutivoActual}', to_jsonb($2::int))
         WHERE clave = $1`,
        [ctx.claveConsecutivo, siguiente - 1],
      );
      for (const p of ctx.pedidos) {
        await manager.query(
          `UPDATE orders
           SET exportado_wo = true, exportado_wo_at = now(),
               wo_documento_numero = $2, lote_exportacion = $3
           WHERE id = $1`,
          [p.id, numeros.get(p.id), lote],
        );
      }
      await this.audit.log(
        {
          usuarioId: user.id,
          usuarioUsername: user.username,
          accion: 'EXPORTACION_WORLD_OFFICE',
          tabla: 'orders',
          registroId: null,
          valorNuevo: {
            empresa: ctx.empresa?.nombre,
            lote,
            pedidos: ctx.pedidos.map((p) => ({
              id: p.id,
              numero: p.numero,
              documentoWo: numeros.get(p.id),
            })),
            lineas: pre.resumen.lineas,
          },
        },
        manager,
      );
      return numeros;
    });

    // I53: el formato que espera WO es .xlsx (hoja con las siglas de la
    // empresa; textos como texto y números como números reales).
    const xlsx = await construirXlsxWo({
      config: ctx.config!,
      empresaNombre: ctx.empresaNombre!,
      siglas: ctx.empresa?.siglas ?? 'WO',
      pedidos: ctx.pedidos,
      numerosWo,
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    // El nombre incluye el/los números de secuencia WO asignados:
    // WO-Pedidos-IRE-3450.xlsx (o WO-Pedidos-IRE-3450-3452.xlsx si son varios)
    const numeros = [...numerosWo.values()];
    const desde = Math.min(...numeros);
    const hasta = Math.max(...numeros);
    const rango = desde === hasta ? `${desde}` : `${desde}-${hasta}`;
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="WO-Pedidos-${ctx.empresa?.siglas ?? 'EMP'}-${rango}.xlsx"`,
    );
    res.send(xlsx);
  }

  /** I51/I52/I62: carga pedidos + cliente + comercial + ítems y la config WO de la empresa. */
  private async cargarContextoWo(orderIds?: string[]): Promise<{
    config: WoConfig | null;
    claveConfig: string;
    empresaNombre: string | null;
    consecutivoActual: number | null;
    claveConsecutivo: string;
    empresa: { id: string; nombre: string; siglas: string } | null;
    pedidos: WoPedidoInput[];
    idsNoEncontrados: string[];
    empresasMezcladas: boolean;
  }> {
    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      throw new BadRequestException('orderIds debe ser un arreglo con al menos un pedido');
    }
    if (orderIds.length > 200) {
      throw new BadRequestException('Máximo 200 pedidos por exportación');
    }
    const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (orderIds.some((id) => typeof id !== 'string' || !uuidOk.test(id))) {
      throw new BadRequestException('orderIds contiene identificadores inválidos');
    }
    const ids = [...new Set(orderIds)];

    const rows: any[] = await this.dataSource.query(
      `SELECT o.id, o.numero, o.estado, o.notas, o.created_at,
              o.exportado_wo, o.wo_documento_numero, o.empresa_id,
              cl.identificacion AS cliente_identificacion,
              co.identificacion AS comercial_identificacion
       FROM orders o
       JOIN clients cl ON cl.id = o.cliente_id
       LEFT JOIN comerciales co ON co.id = o.comercial_id
       WHERE o.id = ANY($1::uuid[])
       ORDER BY o.created_at ASC, o.numero ASC`,
      [ids],
    );
    const encontrados = new Set(rows.map((r) => r.id));
    const idsNoEncontrados = ids.filter((id) => !encontrados.has(id));

    const items: any[] = rows.length
      ? await this.dataSource.query(
          `SELECT order_id, codigo, descripcion, cantidad, valor_unidad
           FROM order_items WHERE order_id = ANY($1::uuid[])
           ORDER BY created_at ASC`,
          [ids],
        )
      : [];
    const itemsPorPedido = new Map<string, any[]>();
    for (const it of items) {
      const arr = itemsPorPedido.get(it.order_id) ?? [];
      arr.push(it);
      itemsPorPedido.set(it.order_id, arr);
    }

    const empresaIds = [...new Set(rows.map((r) => r.empresa_id))];
    const empresasMezcladas = empresaIds.length > 1;
    const empresa = empresaIds.length
      ? ((await this.dataSource.query(
          `SELECT id, nombre, siglas FROM companies WHERE id = $1`,
          [empresaIds[0]],
        ))[0] ?? null)
      : null;
    // I62: la configuración de exportación es POR EMPRESA
    // (wo.export.<SIGLAS>); no existe clave global.
    const claveConsecutivo = `${WO_CONSECUTIVO_PREFIX}${empresa?.siglas ?? '?'}`;
    const claveConfig = woClaveConfig(empresa?.siglas ?? '?');
    const configRow = (
      await this.dataSource.query(
        `SELECT valor FROM system_params WHERE clave = $1`,
        [claveConfig],
      )
    )[0];
    const config: WoConfig | null = configRow?.valor ?? null;
    const consecRow = empresa
      ? await this.dataSource.query(
          `SELECT valor FROM system_params WHERE clave = $1`,
          [claveConsecutivo],
        )
      : [];
    const consecutivoActual =
      consecRow.length && Number.isInteger(consecRow[0]?.valor?.consecutivoActual)
        ? (consecRow[0].valor.consecutivoActual as number)
        : null;

    const pedidos: WoPedidoInput[] = rows.map((r) => ({
      id: r.id,
      numero: r.numero,
      estado: r.estado,
      notas: r.notas,
      createdAt: new Date(r.created_at),
      exportadoWo: r.exportado_wo === true,
      woDocumentoNumero: r.wo_documento_numero,
      clienteIdentificacion: r.cliente_identificacion,
      comercialIdentificacion: r.comercial_identificacion,
      items: (itemsPorPedido.get(r.id) ?? []).map((it) => ({
        codigo: it.codigo,
        descripcion: it.descripcion,
        cantidad: it.cantidad,
        valorUnidad: it.valor_unidad,
      })),
    }));

    return {
      config,
      claveConfig,
      empresaNombre: empresa?.nombre ?? null,
      consecutivoActual,
      claveConsecutivo,
      empresa,
      pedidos,
      idsNoEncontrados,
      empresasMezcladas,
    };
  }

  private async auditExport(user: AuthenticatedUser, reporte: string, registros: number) {    await this.audit.log({
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
