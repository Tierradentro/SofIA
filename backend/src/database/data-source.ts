import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { User } from '../modules/users/entities/user.entity';
import { Company } from '../modules/companies/entities/company.entity';
import { SystemParam } from '../modules/params/entities/system-param.entity';
import { AuditLog } from '../modules/audit/entities/audit-log.entity';
import { PqrsReason } from '../modules/pqrs/entities/pqrs-reason.entity';
import { Carrier } from '../modules/carriers/entities/carrier.entity';
import { ApiKey } from '../modules/api-keys/entities/api-key.entity';
import { Document } from '../modules/documents/entities/document.entity';
import { Client } from '../modules/clients/entities/client.entity';
import { ClientAddress } from '../modules/clients/entities/client-address.entity';
import { Comercial } from '../modules/comerciales/entities/comercial.entity';
import { Product } from '../modules/products/entities/product.entity';
import { ProductBarcode } from '../modules/products/entities/product-barcode.entity';
import { InventoryMovement } from '../modules/movements/entities/inventory-movement.entity';
import { ImportJob } from '../modules/imports/entities/import-job.entity';
import { OcrProvider } from '../modules/ocr/entities/ocr-provider.entity';
import { OcrDocument } from '../modules/ocr/entities/ocr-document.entity';
import { InboundReceipt } from '../modules/inbound/entities/inbound-receipt.entity';
import { InboundItem } from '../modules/inbound/entities/inbound-item.entity';
import { Order } from '../modules/orders/entities/order.entity';
import { OrderItem } from '../modules/orders/entities/order-item.entity';
import { OrderCounter } from '../modules/orders/entities/order-counter.entity';
import { InitI0I11753000000000 } from './migrations/1753000000000-init-i0-i1';
import { AdminI21753000001000 } from './migrations/1753000001000-admin-i2';
import { CatalogosI31753000002000 } from './migrations/1753000002000-catalogos-i3';
import { ImportsI41753000003000 } from './migrations/1753000003000-imports-i4';
import { OcrI51753000004000 } from './migrations/1753000004000-ocr-i5';
import { InboundI61753000005000 } from './migrations/1753000005000-inbound-i6';
import { OrdersI71753000006000 } from './migrations/1753000006000-orders-i7';
import { Dispatch } from '../modules/dispatches/entities/dispatch.entity';
import { DispatchOrder } from '../modules/dispatches/entities/dispatch-order.entity';
import { Box } from '../modules/dispatches/entities/box.entity';
import { BoxItem } from '../modules/dispatches/entities/box-item.entity';
import { DispatchCounter, BoxCounter } from '../modules/dispatches/entities/dispatch-counter.entity';
import { DispatchesI81753000007000 } from './migrations/1753000007000-dispatches-i8';
import { PqrsCase } from '../modules/pqrs/entities/pqrs-case.entity';
import { PqrsSupport } from '../modules/pqrs/entities/pqrs-support.entity';
import { PqrsI91753000008000 } from './migrations/1753000008000-pqrs-i9';
import { StockCount } from '../modules/inventories/entities/stock-count.entity';
import { StockCountItem } from '../modules/inventories/entities/stock-count-item.entity';
import { InventoriesI101753000009000 } from './migrations/1753000009000-inventories-i10';
import { SeguridadI131753000010000 } from './migrations/1753000010000-seguridad-i13';
import { DespachoGlobalI131753000011000 } from './migrations/1753000011000-despacho-global-i13';
import { ApiExternaI131753000012000 } from './migrations/1753000012000-api-externa-i13';
import { DireccionesI151753000013000 } from './migrations/1753000013000-direcciones-i15';
import { TrazabilidadUsuariosI191753000014000 } from './migrations/1753000014000-trazabilidad-usuarios-i19';
import { PedidoDespachadoI251753000015000 } from './migrations/1753000015000-pedido-despachado-i25';
import { Warehouse } from '../modules/warehouses/entities/warehouse.entity';
import { WarehouseFloor } from '../modules/warehouses/entities/warehouse-floor.entity';
import { WarehouseAisle } from '../modules/warehouses/entities/warehouse-aisle.entity';
import { WarehouseZone } from '../modules/warehouses/entities/warehouse-zone.entity';
import { WarehouseRack } from '../modules/warehouses/entities/warehouse-rack.entity';
import { WarehouseArea } from '../modules/warehouses/entities/warehouse-area.entity';
import { WarehouseProductLocation } from '../modules/warehouses/entities/warehouse-product-location.entity';
import { WarehousesI321753000016000 } from './migrations/1753000016000-warehouses-i32';
import { runInitialSeed } from './seeds/initial.seed';

export function buildDataSourceOptions(): DataSourceOptions {
  const isTest = process.env.NODE_ENV === 'test';
  return {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USER || 'sofia_app',
    password: process.env.DB_PASSWORD || 'sofia_secret',
    database: process.env.DB_NAME || 'sofia',
    entities: [
      User,
      Company,
      SystemParam,
      AuditLog,
      PqrsReason,
      Carrier,
      ApiKey,
      Document,
      Client,
      ClientAddress,
      Comercial,
      Product,
      ProductBarcode,
      InventoryMovement,
      ImportJob,
      OcrProvider,
      OcrDocument,
      InboundReceipt,
      InboundItem,
      Order,
      OrderItem,
      OrderCounter,
      Dispatch,
      DispatchOrder,
      Box,
      BoxItem,
      DispatchCounter,
      BoxCounter,
      PqrsCase,
      PqrsSupport,
      StockCount,
      StockCountItem,
      Warehouse,
      WarehouseFloor,
      WarehouseAisle,
      WarehouseZone,
      WarehouseRack,
      WarehouseArea,
      WarehouseProductLocation,
    ],
    migrations: [
      InitI0I11753000000000,
      AdminI21753000001000,
      CatalogosI31753000002000,
      ImportsI41753000003000,
      OcrI51753000004000,
      InboundI61753000005000,
      OrdersI71753000006000,
      DispatchesI81753000007000,
      PqrsI91753000008000,
      InventoriesI101753000009000,
      SeguridadI131753000010000,
      DespachoGlobalI131753000011000,
      ApiExternaI131753000012000,
      DireccionesI151753000013000,
      TrazabilidadUsuariosI191753000014000,
      PedidoDespachadoI251753000015000,
      WarehousesI321753000016000,
    ],
    synchronize: false,
    logging: false,
    // PGlite (entorno de pruebas) atiende una conexión a la vez
    extra: isTest
      ? { max: 1 }
      : {
          max: 10,
          // I28: tras un redeploy el pool de pg conserva sockets que el
          // balanceador/proxy ya cerró; sin keep-alive el primer uso de un
          // socket muerto lanzaba ECONNRESET ("base de datos desconectada").
          // keepAlive + keepAliveInitialDelayMillis hacen que el SO detecte
          // y descarte esos sockets antes de reutilizarlos.
          keepAlive: true,
          keepAliveInitialDelayMillis: 10_000,
          // Una conexión ociosa no vive más de 30 s ni más de 10 min en
          // total: los proxies de PaaS (EasyPanel) reciclan conexiones TCP
          // en redespliegues y el pool se renueva solo.
          idleTimeoutMillis: 30_000,
          maxLifetimeSeconds: 600,
          // Si la BD tarda en responder (arranque simultáneo de servicios),
          // el intento de conexión espera hasta 10 s en vez de fallar de
          // inmediato.
          connectionTimeoutMillis: 10_000,
        },
  };
}

export const AppDataSource = new DataSource(buildDataSourceOptions());

/**
 * I30: promesa única de conexión que comparten main.ts (arranque con
 * reintentos, en segundo plano tras abrir el puerto) y la dataSourceFactory
 * de AppModule. Así TypeOrmModule espera la MISMA conexión resiliente en vez
 * de crear un segundo DataSource que bloquearía el arranque del servidor
 * HTTP (y con ello el health check) mientras la BD no responde.
 */
let promesaConexion: Promise<DataSource> | null = null;

/** Registra la promesa de conexión (la llama main.ts al arrancar). */
export function registrarConexion(p: Promise<DataSource>): void {
  promesaConexion = p;
  // El rechazo lo maneja quien la espera; esto evita unhandled rejection.
  p.catch(() => undefined);
}

/** La espera la fábrica de TypeORM; sin registro previo conecta directo (tests). */
/**
 * Fallback de los tests e2e (sin main.ts): conexión directa. Se recalcula si
 * el DataSource fue destruido al cerrar la app de una suite anterior, y se
 * limpia al fallar para permitir reintentos.
 */
let promesaDirecta: Promise<DataSource> | null = null;

/** La espera la fábrica de TypeORM; con registro previo usa la promesa de main.ts. */
export function esperarConexion(): Promise<DataSource> {
  if (promesaConexion) return promesaConexion;
  if (AppDataSource.isInitialized) return Promise.resolve(AppDataSource);
  if (!promesaDirecta) {
    promesaDirecta = AppDataSource.initialize()
      .then(() => AppDataSource)
      .catch((err) => {
        promesaDirecta = null;
        throw err;
      });
    promesaDirecta.catch(() => undefined);
  }
  return promesaDirecta;
}

/**
 * I30: indica si main.ts ya registró una conexión en segundo plano. Con
 * registro activo, la dataSourceFactory devuelve el DataSource SIN esperar
 * (manualInitialization evita que @nestjs/typeorm lo inicialice y bloquee el
 * arranque): el puerto se abre de inmediato y la BD conecta cuando pueda.
 */
export function conexionEnSegundoPlano(): boolean {
  return promesaConexion !== null;
}

/** I31: códigos de error de Postgres que indican configuración inválida (no transitoria). */
const CODIGOS_CONFIG_BD = new Set([
  '28P01', // password authentication failed
  '28000', // invalid authorization specification
  '3D000', // database does not exist
  '42501', // insufficient privilege
]);

/**
 * I31: distingue un error transitorio ("Postgres aún no responde": vale la
 * pena reintentar) de uno de configuración ("credenciales o base de datos
 * inválidas": reintentar para siempre no lo arregla).
 */
export function esErrorConfiguracionBd(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = String(e?.code ?? '');
  if (CODIGOS_CONFIG_BD.has(code)) return true;
  const msg = String(e?.message ?? '');
  if (
    msg.includes('password authentication failed') ||
    msg.includes('no existe la base de datos') ||
    (msg.includes('database') && msg.includes('does not exist'))
  ) {
    return true;
  }
  return false;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * I30/I31: conecta a la BD con reintentos. Los errores transitorios
 * (Postgres aún no arranca, red del PaaS) se reintentan para siempre con
 * pausa creciente; un error de configuración se reporta UNA vez por minuto
 * en el log para que salte a la vista, sin matar el proceso (el puerto ya
 * está abierto y el health responde degradado, sin 502).
 */
export async function conectarConReintentos(
  ds: DataSource,
  esperaMs = 5000,
): Promise<DataSource> {
  let ultimoAvisoConfig = 0;
  for (let i = 1; ; i++) {
    if (ds.isInitialized) return ds;
    try {
      await ds.initialize();
      if (i > 1) console.log(`Conexión a la base de datos establecida (intento ${i}).`);
      return ds;
    } catch (err) {
      if (esErrorConfiguracionBd(err)) {
        const ahora = Date.now();
        if (ahora - ultimoAvisoConfig > 60_000) {
          ultimoAvisoConfig = ahora;
          console.error(
            'ERROR DE CONFIGURACIÓN DE BD (no se resuelve reintentando): ' +
              `${(err as Error).message}. Revise DB_HOST/DB_PORT/DB_USER/` +
              'DB_PASSWORD/DB_NAME del servicio. El servicio sigue escuchando ' +
              'y reintentando; /api/v1/health reporta baseDatos=error.',
          );
        }
        await espera(60_000);
        continue;
      }
      const pausa = i <= 12 ? esperaMs : 10_000;
      console.warn(
        `BD no disponible aún (intento ${i}): ${(err as Error).message}; reintentando en ${pausa / 1000}s…`,
      );
      await espera(pausa);
    }
  }
}

/**
 * I31: preparación completa de la BD en un solo flujo — conexión resiliente,
 * migraciones y semillas SIEMPRE. Antes dependía de RUN_MIGRATIONS: con esa
 * variable en false el pool podía quedar arriba con un esquema vacío o
 * desactualizado y todo el API caía. Las migraciones son idempotentes y la
 * semilla inicial también, así que correrlas en cada arranque es seguro.
 */
export async function prepararBaseDeDatos(): Promise<DataSource> {
  const ds = await conectarConReintentos(AppDataSource);
  await ds.runMigrations();
  await runInitialSeed(ds);
  console.log('Migraciones y semillas aplicadas; base de datos lista.');
  return ds;
}
