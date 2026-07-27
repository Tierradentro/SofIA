import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Comercial } from './entities/comercial.entity';
import { ComercialesService } from './comerciales.service';
import { ComercialesController } from './comerciales.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [TypeOrmModule.forFeature([Comercial]), AuditModule],
  controllers: [ComercialesController],
  providers: [ComercialesService],
  exports: [ComercialesService],
})
export class ComercialesModule {}
