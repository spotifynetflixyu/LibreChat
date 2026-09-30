import { EToolResources } from 'librechat-data-provider';
import {
  getViableUploadOptions,
  resolvePastedTextFile,
  isPastedTextFilename,
  nextPastedTextFilename,
  PASTE_AS_FILE_MIN_LENGTH,
  PASTED_TEXT_FILENAME,
  type UploadOptionContext,
  type PasteAsFileContext,
} from '../files';

const uploadCtx = (over: Partial<UploadOptionContext> = {}): UploadOptionContext => ({
  provider: 'anthropic',
  endpoint: 'anthropic',
  endpointType: 'anthropic',
  useResponsesApi: false,
  fileSearchEnabled: false,
  codeEnabled: false,
  contextEnabled: true,
  fileSearchAllowedByAgent: true,
  codeAllowedByAgent: true,
  ...over,
});

/** The real option resolver, so these tests exercise production routing rules */
const realOptions =
  (over: Partial<UploadOptionContext> = {}) =>
  (files: File[]) =>
    getViableUploadOptions(files, uploadCtx(over));

const baseCtx = (over: Partial<PasteAsFileContext> = {}): PasteAsFileContext => ({
  enabled: true,
  uploadsDisabled: false,
  isAssistants: false,
  attachedFilenames: new Set<string>(),
  configPending: false,
  getOptions: realOptions(),
  ...over,
});

const longText = 'a'.repeat(PASTE_AS_FILE_MIN_LENGTH + 1);
const thresholdText = 'a'.repeat(PASTE_AS_FILE_MIN_LENGTH);
const shortText = 'a'.repeat(PASTE_AS_FILE_MIN_LENGTH - 1);

describe('resolvePastedTextFile', () => {
  it('leaves a long paste inline when only PaddleOCR context is available', () => {
    expect(resolvePastedTextFile(longText, baseCtx())).toBeNull();
  });

  it('leaves a paste one character below the threshold inline', () => {
    expect(resolvePastedTextFile(shortText, baseCtx())).toBeNull();
  });

  it('leaves a paste at the threshold inline', () => {
    expect(resolvePastedTextFile(thresholdText, baseCtx())).toBeNull();
  });

  it('leaves an empty paste inline', () => {
    expect(resolvePastedTextFile('', baseCtx())).toBeNull();
  });

  it('leaves the paste inline when the setting is off', () => {
    expect(resolvePastedTextFile(longText, baseCtx({ enabled: false }))).toBeNull();
  });

  it('leaves the paste inline when uploads are disabled for the endpoint', () => {
    expect(resolvePastedTextFile(longText, baseCtx({ uploadsDisabled: true }))).toBeNull();
  });

  it('leaves the paste inline when no destination accepts a text file', () => {
    const getOptions = realOptions({
      contextEnabled: false,
      fileSearchEnabled: false,
      codeEnabled: false,
    });

    expect(resolvePastedTextFile(longText, baseCtx({ getOptions }))).toBeNull();
  });

  it('leaves the paste inline when context is unavailable even if file search is viable', () => {
    const getOptions = realOptions({ contextEnabled: false, fileSearchEnabled: true });

    expect(resolvePastedTextFile(longText, baseCtx({ getOptions }))).toBeNull();
  });

  it('leaves the paste inline when file search and code are viable but context is not', () => {
    const getOptions = realOptions({ fileSearchEnabled: true, codeEnabled: true });

    expect(resolvePastedTextFile(longText, baseCtx({ getOptions }))).toBeNull();
  });

  it('leaves the paste inline when several destinations compete without context', () => {
    const getOptions = realOptions({
      contextEnabled: false,
      fileSearchEnabled: true,
      codeEnabled: true,
    });

    expect(resolvePastedTextFile(longText, baseCtx({ getOptions }))).toBeNull();
  });

  it('leaves a long paste inline while the file config is pending', () => {
    const getOptions = jest.fn(() => [EToolResources.context]);
    const attachment = resolvePastedTextFile(
      longText,
      baseCtx({ configPending: true, getOptions }),
    );

    expect(attachment).toBeNull();
    expect(getOptions).not.toHaveBeenCalled();
  });

  it('skips option resolution for assistants, which route their own uploads', () => {
    const getOptions = jest.fn(() => []);
    const attachment = resolvePastedTextFile(longText, baseCtx({ isAssistants: true, getOptions }));

    expect(attachment?.file).toBeInstanceOf(File);
    expect(attachment?.toolResource).toBeUndefined();
    expect(getOptions).not.toHaveBeenCalled();
  });

  describe('naming successive pastes', () => {
    it('numbers the next paste so a same-length paste is not seen as a duplicate', () => {
      const attachedFilenames = new Set([PASTED_TEXT_FILENAME]);

      expect(
        resolvePastedTextFile(
          longText,
          baseCtx({ attachedFilenames, isAssistants: true }),
        )?.file.name,
      ).toBe('pasted-text-2.txt');
    });

    it('keeps counting past the numbered names already attached', () => {
      const attachedFilenames = new Set([
        PASTED_TEXT_FILENAME,
        'pasted-text-2.txt',
        'pasted-text-3.txt',
      ]);

      expect(
        resolvePastedTextFile(
          longText,
          baseCtx({ attachedFilenames, isAssistants: true }),
        )?.file.name,
      ).toBe('pasted-text-4.txt');
    });

    it('reuses a freed name when an earlier paste was removed', () => {
      const attachedFilenames = new Set(['pasted-text-2.txt']);

      expect(
        resolvePastedTextFile(
          longText,
          baseCtx({ attachedFilenames, isAssistants: true }),
        )?.file.name,
      ).toBe(PASTED_TEXT_FILENAME);
    });

    it('ignores unrelated attachments when picking the name', () => {
      const attachedFilenames = new Set(['report.pdf', 'notes.txt']);

      expect(
        resolvePastedTextFile(
          longText,
          baseCtx({ attachedFilenames, isAssistants: true }),
        )?.file.name,
      ).toBe(PASTED_TEXT_FILENAME);
    });
  });

  it('does not resolve options for a paste that is too short to attach', () => {
    const getOptions = jest.fn(() => []);
    resolvePastedTextFile(shortText, baseCtx({ getOptions }));

    expect(getOptions).not.toHaveBeenCalled();
  });
});

describe('isPastedTextFilename', () => {
  it('accepts every name the paste flow generates', () => {
    const attachedFilenames = new Set<string>();
    const generated = Array.from({ length: 4 }, () => {
      const name = nextPastedTextFilename(attachedFilenames);
      attachedFilenames.add(name);
      return name;
    });

    expect(generated).toEqual([
      PASTED_TEXT_FILENAME,
      'pasted-text-2.txt',
      'pasted-text-3.txt',
      'pasted-text-4.txt',
    ]);
    expect(generated.every(isPastedTextFilename)).toBe(true);
    /** The counter has no ceiling: a busy composer reaches double digits. */
    expect(isPastedTextFilename('pasted-text-10.txt')).toBe(true);
  });

  it.each([
    ['a deliberate upload that merely mentions pasting', 'my-pasted-text.txt'],
    ['a different extension', 'pasted-text.md'],
    ['a suffix that is not a paste number', 'pasted-text-final.txt'],
    ['a name with the marker in the middle', 'notes-pasted-text.txt'],
    ['a counter the generator never produces', 'pasted-text-1.txt'],
    ['a zero counter the generator never produces', 'pasted-text-0.txt'],
    ['a zero-padded counter the generator never produces', 'pasted-text-02.txt'],
    ['an empty name', ''],
  ])('rejects %s', (_label, filename) => {
    expect(isPastedTextFilename(filename)).toBe(false);
  });

  it('rejects a missing name rather than throwing', () => {
    expect(isPastedTextFilename(undefined)).toBe(false);
    expect(isPastedTextFilename(null)).toBe(false);
  });
});
