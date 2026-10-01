import React from 'react';
import { render, screen } from '@testing-library/react';
import type { OAuthCompactionEvent } from 'librechat-data-provider';
import NativeCompaction from '../NativeCompaction';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    key === 'com_ui_native_compaction_context_too_large'
      ? 'Context exceeds the available capacity. Shorten the message or start a new chat.'
      : key,
}));

const event = (phase: OAuthCompactionEvent['phase']): OAuthCompactionEvent => ({
  id: `compaction-${phase}`,
  runId: 'response-1',
  agentId: 'agent-1',
  executionId: 'execution-1',
  phase,
});

describe('NativeCompaction', () => {
  it('shows the active status only while the response is submitting', () => {
    const { rerender } = render(<NativeCompaction event={event('started')} isSubmitting />);

    expect(screen.getByRole('status')).toHaveTextContent('com_ui_native_compaction_active');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');

    rerender(<NativeCompaction event={event('started')} isSubmitting={false} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each([
    ['completed', 'com_ui_native_compaction_completed'],
    ['failed', 'com_ui_native_compaction_failed'],
  ] as const)('shows a settled %s marker after refresh', (phase, label) => {
    render(<NativeCompaction event={event(phase)} isSubmitting={false} />);

    expect(screen.getByRole('status')).toHaveTextContent(label);
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy');
  });

  it('shows an accessible capacity hint for a context-too-large failure', () => {
    render(
      <NativeCompaction
        event={{ ...event('failed'), code: 'context_too_large' }}
        isSubmitting={false}
      />,
    );

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText(/Context exceeds the available capacity/)).toBeVisible();
  });

  it('hides cancelled compaction markers', () => {
    render(<NativeCompaction event={event('cancelled')} isSubmitting />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
