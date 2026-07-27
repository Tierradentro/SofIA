import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { CorrectionsService } from './corrections.service';
import { AuditModule } from '../audit/audit.module';
import { ParamsModule } from '../params/params.module';

@Module({
  imports: [AuditModule, ParamsModule],
  controllers: [AdminController],
  providers: [CorrectionsService],
})
export class AdminModule {}
