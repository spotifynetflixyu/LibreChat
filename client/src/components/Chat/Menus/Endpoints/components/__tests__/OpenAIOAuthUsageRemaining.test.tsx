import { render, screen } from '@testing-library/react';
import OpenAIOAuthUsageRemaining from '../OpenAIOAuthUsageRemaining';

const mockUseGetOpenAIOAuthUsageQuery = jest.fn();

jest.mock('~/data-provider', () => ({
  useGetOpenAIOAuthUsageQuery: () => mockUseGetOpenAIOAuthUsageQuery(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string) =>
    ({
      com_ui_loading: 'Loading...',
      com_ui_unavailable: 'Unavailable',
      com_ui_usage_remaining: 'Usage remaining',
      com_ui_weekly: 'Weekly',
    })[key] ?? key,
}));

describe('OpenAIOAuthUsageRemaining', () => {
  beforeEach(() => {
    mockUseGetOpenAIOAuthUsageQuery.mockReset();
  });

  it('renders primary and weekly remaining windows', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'available',
        windows: [
          {
            key: 'primary',
            usedPercent: 20,
            remainingPercent: 80,
            limitWindowSeconds: 18000,
            resetAfterSeconds: 14685,
            resetAt: '2026-06-26T11:06:09.000Z',
            limitReached: false,
          },
          {
            key: 'secondary',
            usedPercent: 45,
            remainingPercent: 55,
            limitWindowSeconds: 604800,
            resetAfterSeconds: 517868,
            resetAt: '2026-07-02T06:52:32.000Z',
            limitReached: false,
          },
        ],
      },
      isError: false,
      isLoading: false,
    });

    render(<OpenAIOAuthUsageRemaining />);

    expect(screen.getByText('Usage remaining')).toBeInTheDocument();
    expect(screen.getByText('5h')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Weekly')).toBeInTheDocument();
    expect(screen.getByText('55%')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      isError: false,
      isLoading: true,
    });

    render(<OpenAIOAuthUsageRemaining />);

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders unavailable state', () => {
    mockUseGetOpenAIOAuthUsageQuery.mockReturnValue({
      data: {
        status: 'unavailable',
        reason: 'auth_unavailable',
        windows: [],
      },
      isError: false,
      isLoading: false,
    });

    render(<OpenAIOAuthUsageRemaining />);

    expect(screen.getByText('Unavailable: auth_unavailable')).toBeInTheDocument();
  });
});
