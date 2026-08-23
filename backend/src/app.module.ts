import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import {
  AppDataSource,
  buildDataSourceOptions,
  conexionEnSegundoPlano,
  esperarConexion,
} from './database/data-source';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { AuditModule } from './modules/audit/audit.module';
import { AdminModule } from './modules/admin/admin.module';
import { ParamsModule } from './modules/params/params.module';
import { CarriersModule } from './modules/carriers/carriers.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ComercialesModule } from './modules/comerciales/comerciales.module';
import { ProductsModule } from './modules/products/products.module';
import { MovementsModule } from './modules/movements/movements.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ExportsModule } from './modules/exports/exports.controller';
import { OcrModule } from './modules/ocr/ocr.module';
import { InboundModule } from './modules/inbound/inbound.module';
import { OrdersModule } from './modules/orders/orders.module';
import { DispatchesModule } from './modules/dispatches/dispatches.module';
import { PqrsModule } from './modules/pqrs/pqrs.module';
import { InventoriesModule } from './modules/inventories/inventories.module';
import { ExternalApiModule } from './modules/external-api/external-api.module';


/**
 * Guards globales (JWT + RBAC) se registran en AuthModule, donde están
 * disponibles sus dependencias. El RBAC se enforcea siempre en backend
 * (regla transversal).
 *
 * I30: TypeOrmModule espera la promesa de conexión registrada por main.ts
 * (con reintentos infinitos, lanzada en segundo plano tras abrir el puerto).
 * Así el servidor HTTP escucha de inmediato — el health check responde
 * aunque la BD aún no esté — y el pool queda listo en cuanto conecta.
 * En los tests e2e (sin main.ts) conecta el AppDataSource directamente.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDataSourceOptions(),
        // I30: la inicialización del DataSource la hace main.ts en segundo
        // plano (reintentos infinitos). Sin manualInitialization, el módulo
        // intentaría inicializar aquí y bloquearía el arranque del servidor
        // HTTP (y con ello el health check) mientras la BD no responda.
        manualInitialization: true,
      }),
      // Arranque real (main.ts registró la conexión): devolver el DataSource
      // compartido SIN esperar — el puerto se abre aunque la BD siga caída y
      // /api/v1/health reporta "degradado" hasta que conecte. En los tests
      // e2e (sin main.ts) se espera la conexión directa, como antes.
      dataSourceFactory: async () =>
        conexionEnSegundoPlano() ? AppDataSource : esperarConexion(),
    }),
    ParamsModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    AdminModule,
    CarriersModule,
    ApiKeysModule,
    DocumentsModule,
    ClientsModule,
    ComercialesModule,
    ProductsModule,
    MovementsModule,
    ImportsModule,
    ExportsModule,
    OcrModule,
    InboundModule,
    OrdersModule,
    DispatchesModule,
    PqrsModule,
    InventoriesModule,
    ExternalApiModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
