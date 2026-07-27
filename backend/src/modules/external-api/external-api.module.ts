import { Module } from '@nestjs/common';
import { ExternalApiController } from './external-api.controller';
import { OrdersModule } from '../orders/orders.module';
import { DispatchesModule } from '../dispatches/dispatches.module';

/** EP-12: API externa (X-API-Key + rol API + rate limit). */
@Module({
  imports: [OrdersModule, DispatchesModule],
  controllers: [ExternalApiController],
})
export class ExternalApiModule {}
