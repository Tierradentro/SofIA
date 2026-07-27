import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order } from './entities/order.entity';
import { OrderItem } from './entities/order-item.entity';
import { OrderCounter } from './entities/order-counter.entity';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { AuditModule } from '../audit/audit.module';
import { MovementsModule } from '../movements/movements.module';
import { ProductsModule } from '../products/products.module';
import { InventoriesModule } from '../inventories/inventories.module';

/** EP-07/M08: pedidos y alistamiento. */
@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, OrderCounter]),
    AuditModule,
    MovementsModule,
    ProductsModule,
    InventoriesModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
