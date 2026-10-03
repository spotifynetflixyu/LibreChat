import { memo, type ChangeEvent, type KeyboardEvent } from 'react';
import type { SteelReviewRow, SteelReviewTable } from 'librechat-data-provider';
import type { SteelReviewDraftState } from './session';
import { getSteelReviewDraftCell } from './session';

export interface SteelReviewEditorLabels {
  table: string;
  readonly: string;
}

export interface SteelReviewEditorProps {
  table: SteelReviewTable;
  rows: readonly SteelReviewRow[];
  draft: SteelReviewDraftState;
  labels: SteelReviewEditorLabels;
  onCellChange: (row: SteelReviewRow, header: string, value: string) => void;
}

function isSourceOrPageHeader(header: string): boolean {
  const normalized = header.trim().toLocaleLowerCase();
  return ['file', 'filename', 'page', 'source', '檔案', '頁碼', '來源', '圖片'].some((term) =>
    normalized.includes(term),
  );
}

export function isSteelReviewCellEditable(table: SteelReviewTable, header: string): boolean {
  return table.kind === 'ocr_result' && table.isLatest && !table.readOnly && !isSourceOrPageHeader(header);
}

function displayCellValue(value: string | null | undefined): string {
  return value ?? '';
}

function ReviewCell({
  table,
  row,
  header,
  draft,
  readonlyLabel,
  onCellChange,
}: {
  table: SteelReviewTable;
  row: SteelReviewRow;
  header: string;
  draft: SteelReviewDraftState;
  readonlyLabel: string;
  onCellChange: SteelReviewEditorProps['onCellChange'];
}) {
  const cell = row.values[header];
  if (!cell) {
    return <td className="border-b border-border-light px-3 py-2 align-top" />;
  }

  const draftValue = row.rowId ? getSteelReviewDraftCell(draft, row.rowId, header) : undefined;
  const currentValue = draftValue ?? displayCellValue(cell.effective);
  const changed = displayCellValue(cell.baseline) !== currentValue;
  const editable = Boolean(row.rowId) && isSteelReviewCellEditable(table, header);

  return (
    <td className="border-b border-border-light px-3 py-2 align-top">
      {changed && cell.baseline !== null && cell.baseline !== undefined && (
        <del className="mr-2 text-text-secondary">{cell.baseline}</del>
      )}
      {editable ? (
        <input
          aria-label={`${header} ${row.rowId}`}
          className="min-w-24 rounded border border-border-light bg-surface-primary px-2 py-1 text-sm text-text-primary"
          value={currentValue}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onCellChange(row, header, event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      ) : (
        <span aria-label={`${header}: ${readonlyLabel}`}>{currentValue}</span>
      )}
    </td>
  );
}

const SteelReviewEditor = memo(function SteelReviewEditor({
  table,
  rows,
  draft,
  labels,
  onCellChange,
}: SteelReviewEditorProps) {
  return (
    <div className="max-h-[60vh] overflow-auto rounded-md border border-border-light">
      <table className="min-w-full border-collapse text-sm" aria-label={labels.table}>
        <thead className="bg-surface-secondary">
          <tr>
            {table.headers.map((header) => (
              <th key={header} scope="col" className="border-b border-border-light px-3 py-2 text-left font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.rowId || `ephemeral-${rowIndex}`}>
              {table.headers.map((header) => (
                <ReviewCell
                  key={`${row.rowId || `ephemeral-${rowIndex}`}-${header}`}
                  table={table}
                  row={row}
                  header={header}
                  draft={draft}
                  readonlyLabel={labels.readonly}
                  onCellChange={onCellChange}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default SteelReviewEditor;
