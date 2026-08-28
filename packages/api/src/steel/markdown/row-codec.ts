export function parsePipeTableRow(line: string): string[] | undefined {
  const source = line.trim();
  if (source.length === 0) {
    return undefined;
  }

  const cells: string[] = [];
  let current = '';

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (character === '\\') {
      current += character;
      const next = source[index + 1] ?? '';
      if (next.length > 0) {
        current += next;
        index += 1;
      }
      continue;
    }

    if (character === '|') {
      cells.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  if (cells.length === 0) {
    return undefined;
  }
  cells.push(current);

  if (source.startsWith('|')) {
    cells.shift();
  }
  if (source.endsWith('|') && cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop();
  }

  if (
    cells.length === 0 ||
    (cells.length === 1 && !(source.startsWith('|') && source.endsWith('|')))
  ) {
    return undefined;
  }

  return cells.map(decodeMarkdownTableCell);
}

function decodeMarkdownTableCell(cell: string): string {
  let decoded = '';

  for (let index = 0; index < cell.length; index += 1) {
    const character = cell[index] ?? '';
    const next = cell[index + 1] ?? '';
    if (character === '\\' && (next === '|' || next === '\\')) {
      decoded += next;
      index += 1;
      continue;
    }

    decoded += character;
  }

  return decoded.trim();
}

export function escapeMarkdownTableCell(value: string): string {
  let escaped = '';

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if (character === '\\') {
      escaped += '\\\\';
    } else if (character === '|') {
      escaped += '\\|';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && value[index + 1] === '\n') {
        index += 1;
      }
      escaped += '<br>';
    } else {
      escaped += character;
    }
  }

  return escaped;
}

export function isMarkdownTableSeparatorCell(cell: string): boolean {
  return /^:?-{3,}:?$/.test(cell);
}
