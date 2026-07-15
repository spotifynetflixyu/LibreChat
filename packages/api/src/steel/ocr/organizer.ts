export interface OcrOrganizerInput {
  ocrRulesText: string;
  rawOcrText: string;
}

export interface OcrOrganizer {
  organize(input: OcrOrganizerInput): Promise<{ markdown: string }>;
}

const organizerRulesStart = '[ocr_organizer]';
const organizerRulesEnd = '[/ocr_organizer]';
const fallbackOrganizerRules =
  'No OCR organizer rules are available. Preserve the raw OCR content faithfully, do not invent values, and return only Markdown.';

function countMarker(rules: string, marker: string): number {
  let count = 0;
  let searchFrom = 0;
  while (true) {
    const markerIndex = rules.indexOf(marker, searchFrom);
    if (markerIndex < 0) {
      return count;
    }
    count += 1;
    searchFrom = markerIndex + marker.length;
  }
}

function readMarkedSection(rules: string, sectionName: string, startMarker: string, endMarker: string) {
  const startCount = countMarker(rules, startMarker);
  const endCount = countMarker(rules, endMarker);
  if (startCount !== 1 || endCount !== 1) {
    const markerState =
      startCount === 0 || endCount === 0
        ? 'missing'
        : startCount > 1 || endCount > 1
          ? 'duplicate'
          : 'malformed';
    throw new Error(
      `Invalid OCR organizer rule markers (${markerState} ${sectionName} markers): expected exactly one ${startMarker} and ${endMarker}.`,
    );
  }

  const startIndex = rules.indexOf(startMarker);
  const endIndex = rules.indexOf(endMarker);
  if (endIndex <= startIndex) {
    throw new Error(
      `Invalid OCR organizer rule markers (malformed ${sectionName} section): ${endMarker} must follow ${startMarker}.`,
    );
  }

  const section = rules.slice(startIndex + startMarker.length, endIndex).trim();
  if (!section) {
    throw new Error(`Invalid OCR organizer rule markers (empty ${sectionName} section).`);
  }

  return { startIndex, endIndex, section };
}

export function resolveOcrOrganizerRulesText(rules: string): string {
  if (!rules.trim()) {
    return fallbackOrganizerRules;
  }

  return readMarkedSection(
    rules,
    'organizer',
    organizerRulesStart,
    organizerRulesEnd,
  ).section;
}

export function buildOcrOrganizerPrompt(input: OcrOrganizerInput): string {
  return [
    'Organizer rules:',
    resolveOcrOrganizerRulesText(input.ocrRulesText),
    '',
    'Raw OCR text:',
    input.rawOcrText,
  ].join('\n');
}
