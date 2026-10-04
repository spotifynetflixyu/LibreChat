interface MarkdownFence {
  character: '`' | '~';
  length: number;
}

export interface SteelMarkdownOutputFilter {
  append(delta: string): string;
  finish(): string;
}

function fenceOpening(line: string): MarkdownFence | undefined {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})/u)?.[1];
  if (!marker) return undefined;
  return { character: marker[0] as '`' | '~', length: marker.length };
}

function isFenceClosing(line: string, fence: MarkdownFence): boolean {
  const marker = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/u)?.[1];
  return marker?.[0] === fence.character && marker.length >= fence.length;
}

function headingBaseName(line: string): string | undefined {
  const title = line.match(/^ {0,3}##(?!#)[ \t]+(.+?)[ \t]*$/u)?.[1]
    ?.replace(/[ \t]+#+[ \t]*$/u, '')
    .trim();
  if (!title) return undefined;
  return title.split(/[｜|]/u, 1)[0]?.trim();
}

function isCustomerQuoteHeading(line: string): boolean {
  return headingBaseName(line) === 'customer_quote';
}

/** Remove provider-authored customer_quote sections while preserving fenced examples. */
export function stripCustomerQuoteSections(markdown: string): string {
  const filter = createSteelMarkdownOutputFilter();
  return `${filter.append(markdown)}${filter.finish()}`;
}

export function createSteelMarkdownOutputFilter(): SteelMarkdownOutputFilter {
  let fence: MarkdownFence | undefined;
  let suppressFence = false;
  let suppressCustomerQuote = false;
  let pending = '';
  let lineStart = true;

  const processLine = (line: string): string => {
    const content = line.endsWith('\n') ? line.slice(0, -1) : line;
    const withoutCarriageReturn = content.endsWith('\r') ? content.slice(0, -1) : content;

    if (fence) {
      if (isFenceClosing(withoutCarriageReturn, fence)) {
        fence = undefined;
        const output = suppressFence ? '' : line;
        suppressFence = false;
        return output;
      }
      return suppressFence ? '' : line;
    }

    const opening = fenceOpening(withoutCarriageReturn);
    if (opening) {
      fence = opening;
      suppressFence = suppressCustomerQuote;
      return suppressFence ? '' : line;
    }

    const baseName = headingBaseName(withoutCarriageReturn);
    if (baseName !== undefined) {
      if (isCustomerQuoteHeading(withoutCarriageReturn)) {
        suppressCustomerQuote = true;
        return '';
      }
      suppressCustomerQuote = false;
    }

    return suppressCustomerQuote ? '' : line;
  };

  const isPotentialControlPrefix = (line: string): boolean => {
    const content = line.replace(/^ {0,3}/u, '');
    return '##'.startsWith(content) || content.startsWith('##') ||
      '```'.startsWith(content) || content.startsWith('```') ||
      '~~~'.startsWith(content) || content.startsWith('~~~');
  };

  const flushPartialLine = (): string => {
    if (!pending || (lineStart && isPotentialControlPrefix(pending))) return '';
    const line = pending;
    pending = '';
    lineStart = false;
    return suppressCustomerQuote ? '' : line;
  };

  return {
    append(delta: string): string {
      if (!delta) return '';
      pending += delta;
      let output = '';
      let newlineIndex = pending.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = pending.slice(0, newlineIndex + 1);
        pending = pending.slice(newlineIndex + 1);
        output += processLine(line);
        lineStart = true;
        newlineIndex = pending.indexOf('\n');
      }
      return output + flushPartialLine();
    },

    finish(): string {
      if (!pending) return '';
      const line = pending;
      pending = '';
      lineStart = false;
      return processLine(line);
    },
  };
}
