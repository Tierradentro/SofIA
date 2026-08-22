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
