import { act, render } from '@testing-library/react';
import MessageTimestamp from '../MessageTimestamp';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'en-US' } }),
}));

describe('MessageTimestamp', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-18T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('appends a completed processing duration', () => {
    render(<MessageTimestamp value="2026-08-18T11:59:00.000Z" processingDurationMs={12_000} />);

    expect(document.querySelector('time')).toHaveTextContent('1 minute ago (12s)');
  });

  it('lightly updates second-level relative time from the shared clock', () => {
    render(
      <>
        <MessageTimestamp value="2026-08-18T11:59:57.000Z" processingDurationMs={246_000} />
        <MessageTimestamp value="2026-08-18T11:59:56.000Z" processingDurationMs={246_000} />
      </>,
    );

    expect(document.querySelectorAll('time')[0]).toHaveTextContent('3 seconds ago (4m 06s)');
    expect(document.querySelectorAll('time')[1]).toHaveTextContent('4 seconds ago (4m 06s)');
    expect(jest.getTimerCount()).toBe(1);

    act(() => {
      jest.advanceTimersByTime(2_000);
    });

    expect(document.querySelectorAll('time')[0]).toHaveTextContent('5 seconds ago (4m 06s)');
    expect(document.querySelectorAll('time')[1]).toHaveTextContent('6 seconds ago (4m 06s)');

    act(() => {
      jest.advanceTimersByTime(55_000);
    });

    expect(document.querySelectorAll('time')[0]).toHaveTextContent('1 minute ago (4m 06s)');
    expect(document.querySelectorAll('time')[1]).toHaveTextContent('1 minute ago (4m 06s)');
    expect(jest.getTimerCount()).toBe(1);
  });

  it.each([undefined, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'omits invalid processing duration: %s',
    (processingDurationMs) => {
      render(
        <MessageTimestamp
          value="2026-08-18T11:59:00.000Z"
          processingDurationMs={processingDurationMs}
        />,
      );

      expect(document.querySelector('time')).not.toHaveTextContent('(');
    },
  );
});
