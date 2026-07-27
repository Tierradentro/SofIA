import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OcrProvider } from './entities/ocr-provider.entity';
import { OcrDocument } from './entities/ocr-document.entity';
import { OcrProvidersService } from './ocr-providers.service';
import { OcrService } from './ocr.service';
import { OcrLocalStrategy } from './strategies/ocr-local.strategy';
import { OcrLlmStrategy } from './strategies/ocr-llm.strategy';
import { OcrProvidersController } from './ocr-providers.controller';
import { OcrController } from './ocr.controller';
import { AuditModule } from '../audit/audit.module';
import { DocumentsModule } from '../documents/documents.module';
import { ParamsModule } from '../params/params.module';

/**
 * M13/EP-05: OCR configurable (OCRStrategy centralizada: OCR_LOCAL/OCR_LLM,
 * un motor activo a la vez, seleccionado por parámetro del sistema).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OcrProvider, OcrDocument]),
    AuditModule,
    DocumentsModule,
    ParamsModule,
  ],
  controllers: [OcrProvidersController, OcrController],
  providers: [OcrProvidersService, OcrService, OcrLocalStrategy, OcrLlmStrategy],
  exports: [OcrService, OcrProvidersService],
})
export class OcrModule {}
