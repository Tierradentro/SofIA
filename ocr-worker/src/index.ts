import { createServer } from 'http';
import { execFile } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const PORT = parseInt(process.env.PORT || '3100', 10);
const LANGS = process.env.OCR_TESS_LANGS || 'spa+eng';
const MAX_BODY = 25 * 1024 * 1024; // 25 MB

/**
 * ocr-worker (Spec §8/§9, M13): servicio OCR independiente.
 * I5: expone el motor OCR local (Tesseract + Poppler) como servicio HTTP
 * para que el backend delegue el procesamiento pesado:
 *   GET  /health  → estado del servicio
 *   POST /extract → { texto, confianza } (body = binario del documento,
 *                    header content-type: image/* o application/pdf)
 */
async function tesseractImage(buffer: Buffer): Promise<{ texto: string; confianza: number | null }> {
  const dir = mkdtempSync(join(tmpdir(), 'ocrw-'));
  const input = join(dir, 'input.img');
  writeFileSync(input, buffer);
  const outBase = join(dir, 'out');
  await execFileAsync('tesseract', [input, outBase, '-l', LANGS, '--psm', '6', 'tsv'], {
    timeout: 120000,
  });
  const tsv = readFileSync(`${outBase}.tsv`, 'utf8');
  const lineas: string[] = [];
  let actual: string[] = [];
  let lastLine = -1;
  const confs: number[] = [];
  for (const row of tsv.split('\n').slice(1)) {
    const cols = row.split('\t');
    if (cols.length < 12 || !cols[11] || !cols[11].trim()) continue;
    const lineNum = parseInt(cols[4], 10);
    if (lastLine !== -1 && lineNum !== lastLine) {
      lineas.push(actual.join(' '));
      actual = [];
    }
    actual.push(cols[11].trim());
    lastLine = lineNum;
    const c = parseFloat(cols[10]);
    if (!isNaN(c) && c >= 0) confs.push(c);
  }
  if (actual.length) lineas.push(actual.join(' '));
  const confianza = confs.length
    ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length / 100) * 1000) / 1000
    : null;
  return { texto: lineas.join('\n'), confianza };
}

async function extractPdf(buffer: Buffer): Promise<{ texto: string; confianza: number | null }> {
  const dir = mkdtempSync(join(tmpdir(), 'ocrw-pdf-'));
  const input = join(dir, 'input.pdf');
  writeFileSync(input, buffer);
  try {
    const { stdout } = await execFileAsync('pdftotext', ['-layout', input, '-'], { timeout: 60000 });
    if (stdout.trim().length >= 10) return { texto: stdout, confianza: null };
  } catch {
    // PDF escaneado: continuar con rasterizado
  }
  await execFileAsync(
    'pdftoppm',
    ['-png', '-r', '200', '-f', '1', '-l', '3', input, join(dir, 'page')],
    { timeout: 120000 },
  );
  const paginas = readdirSync(dir).filter((f) => f.startsWith('page') && f.endsWith('.png')).sort();
  let texto = '';
  const confs: number[] = [];
  for (const p of paginas) {
    const r = await tesseractImage(readFileSync(join(dir, p)));
    texto += r.texto + '\n';
    if (r.confianza !== null) confs.push(r.confianza);
  }
  return {
    texto,
    confianza: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
  };
}

const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', engine: 'OCR_LOCAL', langs: LANGS }));
    return;
  }
  if (req.method === 'POST' && req.url === '/extract') {
    const mime = req.headers['content-type'] || '';
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        res.writeHead(413).end('Archivo demasiado grande');
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', async () => {
      const buffer = Buffer.concat(chunks);
      try {
        const r =
          mime === 'application/pdf'
            ? await extractPdf(buffer)
            : mime.startsWith('image/')
              ? await tesseractImage(buffer)
              : null;
        if (!r) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Tipo no soportado: ${mime}` }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r));
      } catch (e: any) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  res.writeHead(404).end('Not found');
});

server.listen(PORT, () => {
  console.log(`ocr-worker (OCR_LOCAL) escuchando en :${PORT}, idiomas=${LANGS}`);
});
