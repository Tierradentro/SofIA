import { DocumentsService } from './documents.service';

describe('DocumentsService — etiqueta 50×30 mm (HU-007)', () => {
  const service = new DocumentsService(null as any, null as any);

  it('genera página con tamaño de página 50×30 mm y autoimpresión', () => {
    const html = service.buildLabelHtml('CAJA-0001', 'data:image/png;base64,AAA');
    expect(html).toContain('size: 50mm 30mm');
    expect(html).toContain('window.print()');
    expect(html).toContain('CAJA-0001');
    expect(html).toContain('data:image/png;base64,AAA');
  });
});
