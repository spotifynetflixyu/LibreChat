import {
  buildFileInstructions,
  hasFileInstructionTarget,
  prefixFileInstructions,
} from './instructions';

describe('file instructions', () => {
  const instructions =
    'Attached images or image-based documents may be rotated. Rotate mentally before reading Chinese text.';

  it('builds configured instructions for image and PDF inputs', () => {
    expect(
      buildFileInstructions({
        config: { fileAnalysis: { instructions } },
        files: [{ mediaType: 'image/png' }],
      }),
    ).toBe(instructions);

    expect(
      buildFileInstructions({
        config: { fileAnalysis: { instructions } },
        files: [{ type: 'application/pdf' }],
      }),
    ).toBe(instructions);
  });

  it('does not build instructions for non-target files or blank config', () => {
    expect(
      buildFileInstructions({
        config: { fileAnalysis: { instructions } },
        files: [{ mediaType: 'text/plain' }],
      }),
    ).toBeUndefined();

    expect(
      buildFileInstructions({
        config: { fileAnalysis: { instructions: '   ' } },
        files: [{ mediaType: 'image/jpeg' }],
      }),
    ).toBeUndefined();
  });

  it('detects target files by media type, type, and PDF extension fallback', () => {
    expect(hasFileInstructionTarget([{ mediaType: 'image/jpeg' }])).toBe(true);
    expect(hasFileInstructionTarget([{ type: 'application/pdf' }])).toBe(true);
    expect(hasFileInstructionTarget([{ filename: 'scan.PDF' }])).toBe(true);
    expect(hasFileInstructionTarget([{ filename: 'report.txt' }])).toBe(false);
  });

  it('prefixes instructions once without mutating original content', () => {
    const content = 'Read this attachment.';

    expect(prefixFileInstructions(content, instructions)).toBe(
      `${instructions}\n\nRead this attachment.`,
    );
    expect(prefixFileInstructions(`${instructions}\n\n${content}`, instructions)).toBe(
      `${instructions}\n\nRead this attachment.`,
    );
  });
});
