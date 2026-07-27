import { Module } from '@nestjs/common';
import { PqrsService } from './pqrs.service';
import { PqrsController } from './pqrs.controller';
import { MovementsModule } from '../movements/movements.module';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';

/** M11 (EP-08): devoluciones (PQRS). */
@Module({
  imports: [MovementsModule, AuditModule, DocumentsModule],
  controllers: [PqrsController],
  providers: [PqrsService],
  exports: [PqrsService],
})
export class PqrsModule {}
