import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Cifrado simétrico AES-256-GCM para secretos en reposo (C-4: API keys de
 * proveedores OCR). La clave maestra llega por OCR_ENCRYPTION_KEY; en su
 * defecto se deriva de JWT_SECRET para no romper entornos de desarrollo.
 *
 * Formato persistido: base64( iv(12) || tag(16) || ciphertext ).
 * Prefijo 'enc:v1:' para distinguir filas cifradas de texto plano legado.
 */
const PREFIX = 'enc:v1:';
const ALGO = 'aes-256-gcm';

function masterKey(): Buffer {
  const raw =
    process.env.OCR_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'sofia-dev-secret';
  // Deriva 32 bytes deterministas a partir del secreto configurado
  return scryptSync(raw, 'sofia-ocr-v1', 32);
}

/** Fail-fast: en producción no se permiten secretos por defecto. */
export function assertSecretsConfigured(): void {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.JWT_SECRET) {
      throw new Error(
        'JWT_SECRET es obligatorio en producción (sin fallback hardcodeado)',
      );
    }
    if (!process.env.OCR_ENCRYPTION_KEY) {
      throw new Error(
        'OCR_ENCRYPTION_KEY es obligatoria en producción para cifrar las API keys de proveedores OCR',
      );
    }
  }
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    // Fila legado en texto plano (anterior a la migración): se usa tal cual
    return stored;
  }
  const buf = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const data = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, masterKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
