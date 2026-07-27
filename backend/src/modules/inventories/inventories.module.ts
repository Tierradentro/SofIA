import { Module } from '@nestjs/common';
import { InventoriesService } from './inventories.service';
import { InventoriesController } from './inventories.controller';
import { MovementsModule } from '../movements/movements.module';
import { AuditModule } from '../audit/audit.module';

/** M12 (EP-09): inventarios por empresa. */
@Module({
  imports: [MovementsModule, AuditModule],
  controllers: [InventoriesController],
  providers: [InventoriesService],
  exports: [InventoriesService],
})
export class InventoriesModule {}
