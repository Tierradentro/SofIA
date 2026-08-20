import { DocumentsService } from './documents.service';

describe('DocumentsService — etiqueta 50×30 mm (HU-007 / I25)', () => {
  const service = new DocumentsService(null as any, null as any);

  it('genera página con tamaño de página 50×30 mm y autoimpresión', () => {
    const html = service.buildLabelHtml('CAJA-0001', 'data:image/png;base64,AAA');
    expect(html).toContain('size: 50mm 30mm');
    expect(html).toContain('window.print()');
    expect(html).toContain('CAJA-0001');
    expect(html).toContain('data:image/png;base64,AAA');
  });

  it('I25: incluye la empresa (o ambas si es mixto) y el número de despacho', () => {
    const html = service.buildLabelHtml(
      'CJA-000123',
      'data:image/png;base64,BBB',
      'DES-000001',
      'IMPORTADORA REPUESTOS ELIZONDO + IMPORTADORA COMERCIAL VARGAS',
    );
    expect(html).toContain('IMPORTADORA REPUESTOS ELIZONDO + IMPORTADORA COMERCIAL VARGAS');
    expect(html).toContain('CJA-000123');
    expect(html).toContain('Despacho DES-000001');
  });

  it('I25: con una sola empresa muestra solo su nombre', () => {
    const html = service.buildLabelHtml(
      'CJA-000124',
      'data:image/png;base64,CCC',
      'DES-000002',
      'IMPORTADORA REPUESTOS ELIZONDO',
    );
    expect(html).toContain('IMPORTADORA REPUESTOS ELIZONDO');
    expect(html).not.toContain(' + ');
  });
});
