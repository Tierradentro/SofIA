import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  encryptSecret,
  isEncrypted,
} from '../../common/crypto/secret-crypto';

/**
 * I13 — Endurecimiento de seguridad:
 * - C-4: cifra en reposo (AES-256-GCM) las API keys de proveedores OCR que
 *   estuvieran en texto plano. La columna crece a 512 para el sobre cifrado.
 */
export class SeguridadI131753000010000 implements MigrationInterface {
  name = 'SeguridadI131753000010000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE ocr_providers ALTER COLUMN api_key TYPE varchar(512)`,
    );
    const rows: { id: string; api_key: string }[] = await queryRunner.query(
      `SELECT id, api_key FROM ocr_providers`,
    );
    for (const r of rows) {
      if (!isEncrypted(r.api_key)) {
        await queryRunner.query(
          `UPDATE ocr_providers SET api_key = $1 WHERE id = $2`,
          [encryptSecret(r.api_key), r.id],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // No se revierte el cifrado (no debe volver a texto plano); solo el tipo
    await queryRunner.query(
      `ALTER TABLE ocr_providers ALTER COLUMN api_key TYPE varchar(300)`,
    );
  }
}
