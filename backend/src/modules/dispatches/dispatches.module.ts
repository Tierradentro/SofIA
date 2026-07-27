import { Module } from '@nestjs/common';
import { DispatchesService } from './dispatches.service';
import { BoxesController, DispatchesController } from './dispatches.controller';
import { MovementsModule } from '../movements/movements.module';
import { AuditModule } from '../audit/audit.module';
import { InventoriesModule } from '../inventories/inventories.module';

/** M09 + M10 (EP-08): despachos y cajas. */
@Module({
  imports: [MovementsModule, AuditModule, InventoriesModule],
  controllers: [DispatchesController, BoxesController],
  providers: [DispatchesService],
  exports: [DispatchesService],
})
export class DispatchesModule {}
