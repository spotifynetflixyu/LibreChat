import {
  classifyEvidenceAttachment,
  createEvidenceAttachmentFromFileRecord,
  createEvidenceAttachmentFromInlineFile,
} from './attachments';

describe('Steel evidence attachments', () => {
  it('classifies image and PDF files as visual quote evidence', () => {
    expect(classifyEvidenceAttachment('image/png')).toBe('image');
    expect(classifyEvidenceAttachment('image/jpeg')).toBe('image');
    expect(classifyEvidenceAttachment('application/pdf')).toBe('pdf');
  });

  it('classifies XLSX files as spreadsheet quote evidence', () => {
    expect(
      classifyEvidenceAttachment(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    ).toBe('spreadsheet');
  });

  it('marks unsupported files without promoting them to Admin import sources', () => {
    const attachment = createEvidenceAttachmentFromInlineFile({
      filename: 'note.exe',
      mediaType: 'application/x-msdownload',
      data: new Uint8Array([1, 2, 3]),
    });

    expect(attachment).toMatchObject({
      kind: 'unsupported',
      sourceChannel: 'quote_conversation_evidence',
      durable: false,
    });
  });

  it('creates durable quote evidence from a Mongo File record and configured storage strategy', () => {
    const attachment = createEvidenceAttachmentFromFileRecord({
      file_id: 'file_123',
      filename: 'scan.pdf',
      filepath: '/uploads/user_1/file_123__scan.pdf',
      source: 'local',
      type: 'application/pdf',
      bytes: 1024,
      storageKey: undefined,
      storageRegion: undefined,
    });

    expect(attachment).toEqual({
      fileId: 'file_123',
      filename: 'scan.pdf',
      mediaType: 'application/pdf',
      kind: 'pdf',
      fileRef: {
        source: 'local',
        filepath: '/uploads/user_1/file_123__scan.pdf',
      },
      bytes: 1024,
      durable: true,
      sourceChannel: 'quote_conversation_evidence',
    });
  });

  it('keeps inline dataBase64-style files as compatibility evidence, not durable storage', () => {
    const data = new Uint8Array([80, 78, 71]);
    const attachment = createEvidenceAttachmentFromInlineFile({
      filename: 'c.png',
      mediaType: 'image/png',
      data,
    });

    expect(attachment).toEqual({
      fileId: expect.stringMatching(/^inline_/),
      filename: 'c.png',
      mediaType: 'image/png',
      kind: 'image',
      data,
      durable: false,
      sourceChannel: 'quote_conversation_evidence',
    });
  });
});
