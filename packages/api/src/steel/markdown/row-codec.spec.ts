import { escapeMarkdownTableCell, parsePipeTableRow } from './row-codec';

describe('Steel Markdown row codec', () => {
  it('round-trips literal pipes and backslashes exactly once', () => {
    const cells = ['A|B', 'C:\\path'];
    const markdown = `| ${cells.map(escapeMarkdownTableCell).join(' | ')} |`;

    expect(markdown).toBe('| A\\|B | C:\\\\path |');
    expect(parsePipeTableRow(markdown)).toEqual(cells);
  });

  it('preserves unrelated backslash sequences', () => {
    expect(parsePipeTableRow('| C:\\path | 1 |')).toEqual(['C:\\path', '1']);
  });
});
