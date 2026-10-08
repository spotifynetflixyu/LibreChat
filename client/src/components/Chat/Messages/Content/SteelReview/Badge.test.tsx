import React from 'react';
import { render, screen } from '@testing-library/react';
import type { SteelReviewTable } from 'librechat-data-provider';
import { createSteelReviewOcrContextTable } from './reference';
import SteelReviewBadge from './Badge';
import { useLocalize } from '~/hooks';

jest.mock('~/hooks', () => ({
  useLocalize: jest.fn(),
}));

jest.mock('@librechat/client', () => ({
  Tag: ({ label, variant }: { label: string; variant: string }) => (
    <span data-testid="steel-review-badge" data-variant={variant}>
      {label}
    </span>
  ),
}));

const mockUseLocalize = useLocalize as jest.Mock;

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
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalize.mockReturnValue((key: string) => ({
      com_ui_steel_review_latest_version: 'Latest version',
      com_ui_steel_review_previous_version: 'Previous version',
      com_ui_steel_review_readonly_badge: 'Read-only',
    })[key]);
  });

  it('uses the loaded legacy table state when no versions entry exists', () => {
    render(<SteelReviewBadge table={table()} />);

    expect(screen.getByTestId('steel-review-badge')).toHaveTextContent('Latest version');
    expect(screen.getByTestId('steel-review-badge')).toHaveAttribute('data-variant', 'success');
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

    expect(screen.getByTestId('steel-review-badge')).toHaveTextContent('Read-only');
    expect(screen.getByTestId('steel-review-badge')).toHaveAttribute('data-variant', 'neutral');
  });

  it('derives a legacy previous version label from the loaded table state', () => {
    render(<SteelReviewBadge table={table({ isLatest: false, readOnly: true })} />);

    expect(screen.getByTestId('steel-review-badge')).toHaveTextContent('Previous version');
  });

  it('keeps the matching version save count when the entry is trustworthy', () => {
    render(<SteelReviewBadge table={table({ isLatest: false, readOnly: true })} version={{ latest: false, saves: 2 }} />);

    expect(screen.getByTestId('steel-review-badge')).toHaveTextContent('Previous version v3');
  });

  it('keeps a historical table previous while the versions cache still says latest', () => {
    render(
      <SteelReviewBadge
        table={table({ isLatest: false, readOnly: true })}
        version={{ latest: true, saves: 0 }}
      />,
    );
    expect(screen.getByTestId('steel-review-badge')).toHaveTextContent('Previous version');
  });
});
