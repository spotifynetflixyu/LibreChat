import { act, render, screen } from '@testing-library/react';
import useTimeTick from '../useTimeTick';

function TickValue({ cadenceMs, testId }: { cadenceMs: number; testId: string }) {
  const now = useTimeTick(cadenceMs);
  return <span data-testid={testId}>{now}</span>;
}

describe('useTimeTick', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(0);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the slower cadence due time when the fast subscriber leaves', () => {
    const { rerender } = render(
      <>
        <TickValue cadenceMs={60_000} testId="slow" />
        <TickValue cadenceMs={1_000} testId="fast" />
      </>,
    );

    act(() => {
      jest.advanceTimersByTime(59_000);
    });
    expect(screen.getByTestId('slow')).toHaveTextContent('0');

    rerender(<TickValue cadenceMs={60_000} testId="slow" />);
    act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(screen.getByTestId('slow')).toHaveTextContent('60000');
    expect(jest.getTimerCount()).toBe(1);
  });
});
