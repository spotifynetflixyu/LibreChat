import { render, screen } from '@testing-library/react';
import type { TFile } from 'librechat-data-provider';

import { columns } from './Columns';

describe('Attach Files table date column', () => {
  it('sorts and renders from createdAt', () => {
    const dateColumn = columns.find(
      (column) =>
        'accessorKey' in column &&
        (column.accessorKey === 'createdAt' || column.accessorKey === 'updatedAt'),
    );

    if (!dateColumn || !('accessorKey' in dateColumn) || typeof dateColumn.cell !== 'function') {
      throw new Error('Expected the date column to provide a cell renderer');
    }
    expect(dateColumn.accessorKey).toBe('createdAt');

    const file: TFile = {
      user: 'user-1',
      file_id: 'file-1',
      bytes: 1,
      embedded: false,
      filename: 'drawing.png',
      filepath: '/tmp/drawing.png',
      object: 'file',
      type: 'image/png',
      usage: 0,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2030-01-01T00:00:00.000Z',
    };
    const cell = dateColumn.cell;
    const DateCell = () => <>{cell({ row: { original: file } } as Parameters<typeof cell>[0])}</>;

    render(<DateCell />);
    expect(screen.getByText('1 Jan 2020')).toBeInTheDocument();
  });
});
