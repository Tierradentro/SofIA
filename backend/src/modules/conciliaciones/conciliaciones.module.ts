import { Module } from '@nestjs/common';
import { ConciliacionesController } from './conciliaciones.controller';
import { ConciliacionesService } from './conciliaciones.service';
import { ImportParserService } from '../imports/import-parser.service';
import { AuditModule } from '../audit/audit.module';

/** I65h — Conciliaciones WO vs. SofIA (Administración / Administrador). */
@Module({
  imports: [AuditModule],
  controllers: [ConciliacionesController],
  providers: [ConciliacionesService, ImportParserService],
})
export class ConciliacionesModule {}
