import { render } from '@testing-library/react';
import LeaveSiteWarning from '../LeaveSiteWarning';

const mockUseBeforeUnload = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => `${key}:localized`,
}));
jest.mock('react-router-dom', () => ({
  useBeforeUnload: (
    callback: (event: BeforeUnloadEvent) => void,
    options?: AddEventListenerOptions,
  ) => mockUseBeforeUnload(callback, options),
}));

describe('LeaveSiteWarning', () => {
  beforeEach(() => {
    mockUseBeforeUnload.mockClear();
  });

  it('always enables the browser unload warning without route prompts', () => {
    render(<LeaveSiteWarning />);

    expect(mockUseBeforeUnload).toHaveBeenCalledWith(expect.any(Function), { capture: true });

    const handler = mockUseBeforeUnload.mock.calls[0]?.[0] as
      | ((event: BeforeUnloadEvent) => void)
      | undefined;
    const event = {
      preventDefault: jest.fn(),
      returnValue: '',
    } as unknown as BeforeUnloadEvent;

    handler?.(event);

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.returnValue).toBe('com_ui_leave_site_warning:localized');
  });
});
