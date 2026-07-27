import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { Product } from '../products/entities/product.entity';
import { MovementsService } from './movements.service';
import { MovementsController } from './movements.controller';

/**
 * Módulo transversal de movimientos (D-01). Lo importan los módulos que
 * mutan existencias: Products (I3), Imports (I4), Inbound (I6),
 * Orders (I7), Dispatches (I8), Returns (I9), Inventories (I10).
 */
@Module({
  imports: [TypeOrmModule.forFeature([InventoryMovement, Product])],
  controllers: [MovementsController],
  providers: [MovementsService],
  exports: [MovementsService],
})
export class MovementsModule {}
