import { Module } from '@nestjs/common';
import { ExternalApiController } from './external-api.controller';
import { OrdersModule } from '../orders/orders.module';
import { DispatchesModule } from '../dispatches/dispatches.module';
import { ClientsModule } from '../clients/clients.module';
import { ComercialesModule } from '../comerciales/comerciales.module';
import { CompaniesModule } from '../companies/companies.module';
import { ProductsModule } from '../products/products.module';

/** EP-12: API externa (X-API-Key + rol API + rate limit). */
@Module({
  imports: [OrdersModule, DispatchesModule, ClientsModule, ComercialesModule, CompaniesModule, ProductsModule],
  controllers: [ExternalApiController],
})
export class ExternalApiModule {}
