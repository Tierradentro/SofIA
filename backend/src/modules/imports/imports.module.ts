import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImportJob } from './entities/import-job.entity';
import { ImportsService } from './imports.service';
import { ImportsController } from './imports.controller';
import { ImportParserService } from './import-parser.service';
import { ImportValidatorService } from './import-validator.service';
import { AuditModule } from '../audit/audit.module';
import { MovementsModule } from '../movements/movements.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ImportJob]),
    AuditModule,
    MovementsModule,
  ],
  controllers: [ImportsController],
  providers: [ImportsService, ImportParserService, ImportValidatorService],
})
export class ImportsModule {}
