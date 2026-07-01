import React from 'react';
import { act, render, screen } from '@testing-library/react';
import MessageElapsedTimer, { formatElapsedTime } from '../MessageElapsedTimer';

describe('MessageElapsedTimer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('formats elapsed time with compact s/m labels', () => {
    expect(formatElapsedTime(0)).toBe('0s');
    expect(formatElapsedTime(12_400)).toBe('12s');
    expect(formatElapsedTime(65_000)).toBe('1m 05s');
    expect(formatElapsedTime(150_000)).toBe('2m 30s');
  });

  it('does not render for user messages', () => {
    render(<MessageElapsedTimer isCreatedByUser isSubmitting startedAt={0} />);

    expect(screen.queryByTestId('message-elapsed-timer')).not.toBeInTheDocument();
  });

  it('ticks while the assistant turn is submitting', () => {
    jest.setSystemTime(12_000);
    render(<MessageElapsedTimer isCreatedByUser={false} isSubmitting startedAt={0} />);

    const timer = screen.getByTestId('message-elapsed-timer');
    expect(timer).toHaveTextContent('12s');
    expect(timer).toHaveClass('ml-2');
    expect(timer).toHaveClass('text-xs');
    expect(timer).toHaveClass('font-normal');
    expect(timer).toHaveClass('text-text-secondary');

    act(() => {
      jest.advanceTimersByTime(3_000);
    });

    expect(screen.getByTestId('message-elapsed-timer')).toHaveTextContent('15s');
  });

  it('freezes elapsed time when the assistant turn completes', () => {
    jest.setSystemTime(12_000);
    const { rerender } = render(
      <MessageElapsedTimer isCreatedByUser={false} isSubmitting startedAt={0} />,
    );

    jest.setSystemTime(18_000);
    rerender(<MessageElapsedTimer isCreatedByUser={false} isSubmitting={false} startedAt={0} />);

    expect(screen.getByTestId('message-elapsed-timer')).toHaveTextContent('18s');

    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(screen.getByTestId('message-elapsed-timer')).toHaveTextContent('18s');
  });
});
