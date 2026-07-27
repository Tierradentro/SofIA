import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { buildDataSourceOptions } from './database/data-source';
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
 */
@Module({
  imports: [
    TypeOrmModule.forRoot(buildDataSourceOptions()),
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
