import { getSteelFileBytes } from './ocr';

describe('Steel OCR file bytes', () => {
  it('copies Uint8Array source bytes before OCR processing can transfer them', () => {
    const source = new Uint8Array([1, 2, 3]);

    const bytes = getSteelFileBytes({
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
      data: source,
    });

    expect(bytes).toEqual(source);
    expect(bytes).not.toBe(source);

    bytes[0] = 9;
    expect(source[0]).toBe(1);
  });
});
