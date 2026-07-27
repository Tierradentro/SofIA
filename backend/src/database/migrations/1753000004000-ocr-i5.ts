import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * I5 — OCR (EP-05, M13):
 * - ocr_providers: proveedores LLM configurables (HU-019), un solo ACTIVO.
 * - ocr_documents: resultados de procesamiento con datos editables (HU-021).
 * Reutiliza document_type_enum de I2 para el tipo de documento.
 */
export class OcrI51753000004000 implements MigrationInterface {
  name = 'OcrI51753000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE ocr_provider_kind_enum AS ENUM ('OPENAI', 'GEMINI', 'OPENROUTER')
    `);
    await queryRunner.query(`
      CREATE TYPE ocr_provider_status_enum AS ENUM ('ACTIVO', 'INACTIVO')
    `);
    await queryRunner.query(`
      CREATE TYPE ocr_engine_enum AS ENUM ('OCR_LOCAL', 'OCR_LLM')
    `);
    await queryRunner.query(`
      CREATE TYPE ocr_document_status_enum AS ENUM ('CREADO', 'CONFIRMADO')
    `);

    await queryRunner.query(`
      CREATE TABLE ocr_providers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        proveedor ocr_provider_kind_enum NOT NULL,
        nombre varchar(120) NOT NULL,
        modelo varchar(120) NOT NULL,
        api_key varchar(300) NOT NULL,
        estado ocr_provider_status_enum NOT NULL DEFAULT 'INACTIVO',
        prioridad int NOT NULL DEFAULT 100,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // M13: solo un proveedor/modelo activo al mismo tiempo (garantía a nivel BD)
    await queryRunner.query(`
      CREATE UNIQUE INDEX ocr_providers_single_active
      ON ocr_providers ((estado)) WHERE estado = 'ACTIVO'
    `);

    await queryRunner.query(`
      CREATE TABLE ocr_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        tipo_documento document_type_enum NOT NULL,
        motor ocr_engine_enum NOT NULL,
        provider_id uuid REFERENCES ocr_providers(id),
        estado ocr_document_status_enum NOT NULL DEFAULT 'CREADO',
        confianza numeric(4,3),
        datos_extraidos jsonb NOT NULL,
        texto_crudo text,
        empresa_id uuid REFERENCES companies(id),
        created_by uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        confirmed_at timestamptz
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ocr_documents_document_idx ON ocr_documents (document_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ocr_documents_estado_idx ON ocr_documents (estado)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS ocr_documents`);
    await queryRunner.query(`DROP TABLE IF EXISTS ocr_providers`);
    await queryRunner.query(`DROP TYPE IF EXISTS ocr_document_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS ocr_engine_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS ocr_provider_status_enum`);
    await queryRunner.query(`DROP TYPE IF EXISTS ocr_provider_kind_enum`);
  }
}
