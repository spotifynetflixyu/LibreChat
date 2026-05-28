import JSZip from 'jszip';
import sharp from 'sharp';

import type { SteelOAuthChatFile } from './provider';

export type SteelOAuthFileCapabilityFixtureId =
  | 'txt'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'png'
  | 'jpg-rotated';

export interface SteelOAuthFileCapabilityExpected {
  sentinel: string;
  english: string;
  chinese: string;
  number: string;
}

export interface SteelOAuthFileCapabilityFixture {
  id: SteelOAuthFileCapabilityFixtureId;
  file: SteelOAuthChatFile & { filename: string };
  expected: SteelOAuthFileCapabilityExpected;
}

const ENGLISH_PHRASE = 'Steel OAuth capability smoke';
const CHINESE_PHRASE = '鋼鐵檔案測試';
const NUMBER_VALUE = '73921';

function buildFixtureText(sentinel: string) {
  return [
    `Sentinel: ${sentinel}`,
    `English: ${ENGLISH_PHRASE}`,
    `Chinese: ${CHINESE_PHRASE}`,
    `Number: ${NUMBER_VALUE}`,
  ].join('\n');
}

function expected(sentinel: string): SteelOAuthFileCapabilityExpected {
  return {
    sentinel,
    english: ENGLISH_PHRASE,
    chinese: CHINESE_PHRASE,
    number: NUMBER_VALUE,
  };
}

function encodeUtf8(text: string) {
  return new TextEncoder().encode(text);
}

function escapeXml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function createFixtureSvg(text: string) {
  const lines = text.split('\n');
  const svgLines = lines
    .map(
      (line, index) =>
        `<text x="48" y="${80 + index * 70}" font-size="34" font-family="Arial, sans-serif" fill="#111827">${escapeXml(
          line,
        )}</text>`,
    )
    .join('');

  return `<svg width="1200" height="420" viewBox="0 0 1200 420" xmlns="http://www.w3.org/2000/svg">
    <rect width="1200" height="420" fill="#ffffff"/>
    <rect x="24" y="24" width="1152" height="372" fill="none" stroke="#2563eb" stroke-width="8"/>
    ${svgLines}
  </svg>`;
}

function createPdfFromJpeg(jpeg: Buffer, width: number, height: number) {
  const drawWidth = 500;
  const drawHeight = Math.round((drawWidth * height) / width);
  const drawContent = `q\n${drawWidth} 0 0 ${drawHeight} 56 500 cm\n/Im1 Do\nQ`;
  const streamObject = (dictionary: string, data: Buffer | string) =>
    Buffer.concat([
      Buffer.from(`${dictionary}\nstream\n`, 'binary'),
      typeof data === 'string' ? Buffer.from(data, 'binary') : data,
      Buffer.from('\nendstream', 'binary'),
    ]);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'binary'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'binary'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
      'binary',
    ),
    streamObject(`<< /Length ${Buffer.byteLength(drawContent)} >>`, drawContent),
    streamObject(
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
      jpeg,
    ),
  ];
  const chunks = [Buffer.from('%PDF-1.4\n', 'binary')];
  const offsets = [0];
  let position = chunks[0].length;

  objects.forEach((object, index) => {
    offsets.push(position);
    const wrapped = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, 'binary'),
      object,
      Buffer.from('\nendobj\n', 'binary'),
    ]);
    chunks.push(wrapped);
    position += wrapped.length;
  });

  const xrefOffset = position;
  let trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    trailer += `${offsets[index].toString().padStart(10, '0')} 00000 n \n`;
  }
  trailer += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  chunks.push(Buffer.from(trailer, 'binary'));

  return new Uint8Array(Buffer.concat(chunks));
}

async function createPdfBytes(text: string) {
  const { data, info } = await sharp(Buffer.from(createFixtureSvg(text)))
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });

  return createPdfFromJpeg(data, info.width, info.height);
}

async function createDocxBytes(text: string) {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip
    .folder('_rels')
    ?.file(
      '.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    );
  const paragraphs = text
    .split('\n')
    .map((line) => `<w:p><w:r><w:t>${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  zip
    .folder('word')
    ?.file(
      'document.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${paragraphs}<w:sectPr/></w:body>` +
        '</w:document>',
    );

  return new Uint8Array(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function createXlsxBytes(text: string) {
  const XLSX = await import('xlsx');
  const rows = text.split('\n').map((line) => {
    const [label, value] = line.split(': ');
    return [label, value];
  });
  const worksheet = XLSX.utils.aoa_to_sheet([['Field', 'Value'], ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'OAuthSmoke');
  const data = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  return new Uint8Array(data);
}

async function createPngBytes(text: string) {
  return new Uint8Array(
    await sharp(Buffer.from(createFixtureSvg(text)))
      .png()
      .toBuffer(),
  );
}

async function createRotatedJpgBytes(text: string) {
  return new Uint8Array(
    await sharp(Buffer.from(createFixtureSvg(text)))
      .rotate(90)
      .jpeg({ quality: 92 })
      .toBuffer(),
  );
}

export async function createSteelOAuthFileCapabilityFixtures(): Promise<
  SteelOAuthFileCapabilityFixture[]
> {
  const txtSentinel = 'TXT_SENTINEL_7F3A';
  const pdfSentinel = 'PDF_SENTINEL_9C21';
  const docxSentinel = 'DOCX_SENTINEL_A4D8';
  const xlsxSentinel = 'XLSX_SENTINEL_E62B';
  const pngSentinel = 'PNG_SENTINEL_B7E4';
  const rotatedJpgSentinel = 'JPG_ROTATED_SENTINEL_C5F9';

  return [
    {
      id: 'txt',
      file: {
        filename: 'steel-oauth-smoke.txt',
        mediaType: 'text/plain',
        data: encodeUtf8(buildFixtureText(txtSentinel)),
      },
      expected: expected(txtSentinel),
    },
    {
      id: 'pdf',
      file: {
        filename: 'steel-oauth-smoke.pdf',
        mediaType: 'application/pdf',
        data: await createPdfBytes(buildFixtureText(pdfSentinel)),
      },
      expected: expected(pdfSentinel),
    },
    {
      id: 'docx',
      file: {
        filename: 'steel-oauth-smoke.docx',
        mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        data: await createDocxBytes(buildFixtureText(docxSentinel)),
      },
      expected: expected(docxSentinel),
    },
    {
      id: 'xlsx',
      file: {
        filename: 'steel-oauth-smoke.xlsx',
        mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        data: await createXlsxBytes(buildFixtureText(xlsxSentinel)),
      },
      expected: expected(xlsxSentinel),
    },
    {
      id: 'png',
      file: {
        filename: 'steel-oauth-smoke.png',
        mediaType: 'image/png',
        data: await createPngBytes(buildFixtureText(pngSentinel)),
      },
      expected: expected(pngSentinel),
    },
    {
      id: 'jpg-rotated',
      file: {
        filename: 'steel-oauth-smoke-rotated.jpg',
        mediaType: 'image/jpeg',
        data: await createRotatedJpgBytes(buildFixtureText(rotatedJpgSentinel)),
      },
      expected: expected(rotatedJpgSentinel),
    },
  ];
}
