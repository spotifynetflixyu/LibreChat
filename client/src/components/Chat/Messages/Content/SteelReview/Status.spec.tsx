import { render, screen } from '@testing-library/react';
import ReviewStatus from './Status';

describe('Steel review save status', () => {
  it('renders one compact loading status and hides it when cleared', () => {
    const view = render(<ReviewStatus status={{ kind: 'saving', message: 'Saving 1 row…' }} />);
    const status = screen.getByRole('status');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(status).toHaveTextContent('Saving 1 row…');
    expect(status.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    view.rerender(<ReviewStatus />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('replaces loading with a danger-colored error and preserves retry controls', () => {
    const retryLabel = 'Retry';
    const view = render(<ReviewStatus status={{ kind: 'saving', message: 'Saving 1 row…' }} />);
    view.rerender(<ReviewStatus status={{ kind: 'error', message: 'Save failed' }}>
      <button type="button">{retryLabel}</button>
    </ReviewStatus>);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toHaveClass('text-text-destructive');
    expect(screen.getByRole('alert')).toHaveTextContent('Save failed');
    expect(screen.getByRole('alert').querySelector('svg')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
