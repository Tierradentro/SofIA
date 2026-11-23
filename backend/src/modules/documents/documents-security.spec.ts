import { DocumentsService, mimeImagenSegura } from './documents.service';
import { generarClaveInicial } from '../../database/seeds/initial.seed';

/**
 * I73 — pruebas unitarias de las correcciones de la auditoría:
 * - Hallazgo 3: lista blanca de imágenes por magic bytes (anti-XSS vía SVG).
 * - Hallazgo 5: escape de HTML en la etiqueta y validación del data URL.
 * - Hallazgo 4: clave inicial aleatoria del Admin en instalación nueva.
 */
describe('Seguridad de documentos y semilla (auditoría I73)', () => {
  const PNG = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
  ]);
  const JPEG = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1,
  ]);
  const WEBP = Buffer.from('RIFF\x1a\x00\x00\x00WEBPVP8 ', 'binary');
  const SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x80\x00\x00', 'binary');
  const RIFF_WAVE = Buffer.from('RIFF\x1a\x00\x00\x00WAVEfmt ', 'binary');

  describe('mimeImagenSegura (hallazgo 3)', () => {
    it('acepta PNG, JPEG y WEBP reales verificados por bytes', () => {
      expect(mimeImagenSegura(PNG)).toBe('image/png');
      expect(mimeImagenSegura(JPEG)).toBe('image/jpeg');
      expect(mimeImagenSegura(WEBP)).toBe('image/webp');
    });

    it('rechaza un SVG con <script> aunque declare ser imagen', () => {
      expect(mimeImagenSegura(SVG)).toBeNull();
    });

    it('rechaza GIF, RIFF no-WEBP y buffers cortos o vacíos', () => {
      expect(mimeImagenSegura(GIF)).toBeNull();
      expect(mimeImagenSegura(RIFF_WAVE)).toBeNull();
      expect(mimeImagenSegura(Buffer.from('tiny'))).toBeNull();
      expect(mimeImagenSegura(Buffer.alloc(0))).toBeNull();
    });
  });

  describe('buildLabelHtml (hallazgo 5)', () => {
    // buildLabelHtml no toca repositorios: se instancia con dependencias nulas.
    const service = new DocumentsService(null as any, null as any);
    const PNG_DATA_URL = `data:image/png;base64,${PNG.toString('base64')}`;

    it('escapa empresa, código de caja y número de despacho', () => {
      const html = service.buildLabelHtml(
        'CJA-<script>alert(1)</script>',
        PNG_DATA_URL,
        'DES-<img src=x onerror=alert(1)>',
        'IRE"><svg onload=alert(1)>',
      );
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('CJA-&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('DES-<img src=x');
      expect(html).toContain('DES-&lt;img src=x onerror=alert(1)&gt;');
      expect(html).toContain('IRE&quot;&gt;&lt;svg onload=alert(1)&gt;');
    });

    it('conserva un data URL PNG/JPEG válido y descarta cualquier otro', () => {
      const ok = service.buildLabelHtml('CJA-000001', PNG_DATA_URL);
      expect(ok).toContain(`src="${PNG_DATA_URL}"`);

      const svg = service.buildLabelHtml(
        'CJA-000001',
        'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
      );
      expect(svg).toContain('src=""');
      expect(svg).not.toContain('data:image/svg');

      const js = service.buildLabelHtml('CJA-000001', 'javascript:alert(1)');
      expect(js).toContain('src=""');
    });
  });

  describe('generarClaveInicial (hallazgo 4)', () => {
    it('12 caracteres con mayúscula, minúscula y dígito, sin ambiguos', () => {
      for (let i = 0; i < 200; i++) {
        const clave = generarClaveInicial();
        expect(clave).toMatch(
          /^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789]{12}$/,
        );
        expect(clave).toMatch(/[A-Z]/);
        expect(clave).toMatch(/[a-z]/);
        expect(clave).toMatch(/[0-9]/);
      }
    });

    it('no produce la clave fija «Admin» ni repite valores', () => {
      const claves = new Set(
        Array.from({ length: 50 }, () => generarClaveInicial()),
      );
      expect(claves.size).toBe(50);
      expect(claves.has('Admin')).toBe(false);
    });
  });
});
