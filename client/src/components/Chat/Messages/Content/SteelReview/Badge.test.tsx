import React from 'react';
import { render, screen } from '@testing-library/react';
import type { SteelReviewTable } from 'librechat-data-provider';
import { createSteelReviewOcrContextTable } from './reference';
import SteelReviewBadge from './Badge';

const table = (overrides: Partial<SteelReviewTable> = {}): SteelReviewTable => ({
  conversationId: 'conversation-1',
  messageId: 'message-1',
  outputId: 'ocr_result:output-1',
  title: 'ocr_result',
  kind: 'ocr_result',
  revision: 'revision-1',
  latestOutputId: 'ocr_result:output-1',
  isLatest: true,
  readOnly: false,
  headers: ['品名'],
  rows: [],
  ...overrides,
});

describe('SteelReviewBadge', () => {
  it('uses the loaded legacy table state when no versions entry exists', () => {
    render(<SteelReviewBadge table={table()} />);

    expect(screen.getByText('Latest version').parentElement).toHaveClass('text-status-success');
  });

  it('renders the frozen OCR snapshot as read-only', () => {
    const systemTable = table({
      kind: 'system_order',
      title: 'system_order',
      outputId: 'system_order:output-1',
      latestOutputId: 'system_order:output-1',
      ocrContext: {
        title: 'ocr_result｜drawing.pdf',
        outputId: 'ocr_result:snapshot-1',
        revision: 'snapshot-revision',
        headers: ['品名'],
        rows: [],
      },
    });
    const referenceTable = createSteelReviewOcrContextTable(systemTable, systemTable.ocrContext!);

    render(<SteelReviewBadge table={referenceTable} showReadOnly />);

    expect(screen.getByText('Read-only').parentElement).toHaveClass('text-status-neutral');
  });

  it('derives a legacy previous version label from the loaded table state', () => {
    render(<SteelReviewBadge table={table({ isLatest: false, readOnly: true })} />);

    expect(screen.getByText('Previous version')).toBeInTheDocument();
  });

  it('keeps the matching version save count when the entry is trustworthy', () => {
    render(<SteelReviewBadge table={table({ isLatest: false, readOnly: true })} version={{ latest: false, saves: 2 }} />);

    expect(screen.getByText('Previous version v3')).toBeInTheDocument();
  });

  it('keeps a historical table previous while the versions cache still says latest', () => {
    render(
      <SteelReviewBadge
        table={table({ isLatest: false, readOnly: true })}
        version={{ latest: true, saves: 0 }}
      />,
    );
    expect(screen.getByText('Previous version')).toBeInTheDocument();
  });
});
