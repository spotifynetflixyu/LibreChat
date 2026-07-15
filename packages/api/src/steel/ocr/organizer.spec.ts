import { buildOcrOrganizerPrompt, resolveOcrOrganizerRulesText } from './organizer';

const organizerRule = 'ORGANIZER_RULE_SENTINEL';
const rawOcrText = 'RAW_OCR_SENTINEL';

describe('OCR organizer interface', () => {
  it('extracts only the organizer section and raw OCR text', () => {
    const prompt = buildOcrOrganizerPrompt({
      ocrRulesText: [
        'UNMARKED_MAIN_RULE',
        '[ocr_shared]',
        'SHARED_RULE_MUST_NOT_BE_INCLUDED',
        '[/ocr_shared]',
        '[ocr_organizer]',
        organizerRule,
        '[/ocr_organizer]',
        '[ocr_main_merge]',
        'MAIN_MERGE_RULE_MUST_NOT_BE_INCLUDED',
        '[/ocr_main_merge]',
        '[final_ocr_markdown]',
        'FINAL_RULE_MUST_NOT_BE_INCLUDED',
        '[/final_ocr_markdown]',
        'Vision_RULE_MUST_NOT_BE_INCLUDED',
      ].join('\n'),
      rawOcrText,
    });

    expect(prompt).toBe(
      ['Organizer rules:', organizerRule, '', 'Raw OCR text:', rawOcrText].join('\n'),
    );
    expect(prompt).not.toContain('[ocr_organizer]');
    expect(prompt).not.toContain('UNMARKED_MAIN_RULE');
    expect(prompt).not.toContain('SHARED_RULE_MUST_NOT_BE_INCLUDED');
    expect(prompt).not.toContain('MAIN_MERGE_RULE_MUST_NOT_BE_INCLUDED');
    expect(prompt).not.toContain('FINAL_RULE_MUST_NOT_BE_INCLUDED');
    expect(prompt).not.toContain('Vision_RULE_MUST_NOT_BE_INCLUDED');
    expect(prompt).not.toContain('file:');
    expect(prompt).not.toContain('chunk');
    expect(prompt).not.toContain('artifact');
  });

  it('returns only the marked organizer rule when other rule sections are present', () => {
    expect(
      resolveOcrOrganizerRulesText(
        [
          '[ocr_shared]',
          'SHARED_RULE',
          '[/ocr_shared]',
          '[ocr_organizer]',
          organizerRule,
          '[/ocr_organizer]',
          '[ocr_main_merge]',
          'MAIN_RULE',
          '[/ocr_main_merge]',
        ].join('\n'),
      ),
    ).toBe(organizerRule);
  });

  it('fails closed when organizer markers are missing, duplicate, empty, or malformed', () => {
    const invalidRules = [
      'Complete OCR rule',
      '[ocr_organizer]\nOrganizer\n[ocr_organizer]\nDuplicate\n[/ocr_organizer]',
      '[ocr_organizer]\nOrganizer\n[/ocr_organizer]\n[/ocr_organizer]',
      '[ocr_organizer]\n[/ocr_organizer]',
      '[/ocr_organizer]\n[ocr_organizer]\nOrganizer',
    ];

    for (const rules of invalidRules) {
      expect(() => resolveOcrOrganizerRulesText(rules)).toThrow(
        /OCR organizer rule markers/u,
      );
    }
  });

  it('builds a prompt from exactly the two organizer inputs', () => {
    const prompt = buildOcrOrganizerPrompt({
      ocrRulesText: `[ocr_organizer]\n${organizerRule}\n[/ocr_organizer]`,
      rawOcrText,
    });

    expect(prompt).toBe(
      ['Organizer rules:', organizerRule, '', 'Raw OCR text:', rawOcrText].join('\n'),
    );
    expect(prompt).not.toContain('Organize this');
    expect(prompt).not.toContain('behavioral');
  });
});
