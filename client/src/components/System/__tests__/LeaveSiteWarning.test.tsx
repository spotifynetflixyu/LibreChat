import { render } from '@testing-library/react';
import LeaveSiteWarning from '../LeaveSiteWarning';

const mockUseUnsavedChangesPrompt = jest.fn();

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => `${key}:localized`,
}));
jest.mock('~/hooks/Generic/useUnsavedChangesPrompt', () => ({
  __esModule: true,
  default: (params: { when: boolean; message: string }) => mockUseUnsavedChangesPrompt(params),
}));

describe('LeaveSiteWarning', () => {
  beforeEach(() => {
    mockUseUnsavedChangesPrompt.mockClear();
  });

  it('always enables browser and route leave warnings', () => {
    render(<LeaveSiteWarning />);

    expect(mockUseUnsavedChangesPrompt).toHaveBeenCalledWith({
      when: true,
      message: 'com_ui_leave_site_warning:localized',
    });
  });
});
