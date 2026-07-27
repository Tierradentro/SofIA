import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboundReceipt } from './entities/inbound-receipt.entity';
import { InboundItem } from './entities/inbound-item.entity';
import { InboundService } from './inbound.service';
import { InboundController } from './inbound.controller';
import { AuditModule } from '../audit/audit.module';
import { MovementsModule } from '../movements/movements.module';
import { InventoriesModule } from '../inventories/inventories.module';

/** EP-06/M07: ingreso de mercancía. */
@Module({
  imports: [
    TypeOrmModule.forFeature([InboundReceipt, InboundItem]),
    AuditModule,
    MovementsModule,
    InventoriesModule,
  ],
  controllers: [InboundController],
  providers: [InboundService],
  exports: [InboundService],
})
export class InboundModule {}
