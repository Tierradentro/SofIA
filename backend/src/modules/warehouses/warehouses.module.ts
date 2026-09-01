import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { WarehouseFloor } from './entities/warehouse-floor.entity';
import { WarehouseAisle } from './entities/warehouse-aisle.entity';
import { WarehouseZone } from './entities/warehouse-zone.entity';
import { WarehouseRack } from './entities/warehouse-rack.entity';
import { WarehouseArea } from './entities/warehouse-area.entity';
import { WarehouseProductLocation } from './entities/warehouse-product-location.entity';
import { ProductBarcode } from '../products/entities/product-barcode.entity';
import { WarehousesService } from './warehouses.service';
import { WarehousesController } from './warehouses.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Warehouse,
      WarehouseFloor,
      WarehouseAisle,
      WarehouseZone,
      WarehouseRack,
      WarehouseArea,
      WarehouseProductLocation,
      ProductBarcode,
    ]),
    AuditModule,
  ],
  controllers: [WarehousesController],
  providers: [WarehousesService],
  exports: [WarehousesService],
})
export class WarehousesModule {}
