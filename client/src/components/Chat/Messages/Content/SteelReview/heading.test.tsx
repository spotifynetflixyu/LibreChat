import React from 'react';
import { QueryKeys } from 'librechat-data-provider';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SteelMarkdownVersion, TMessage } from 'librechat-data-provider';
import { useGetSteelMarkdownVersionsQuery } from '~/data-provider';
import { SteelHeading, SteelVersionsProvider } from './heading';
import { MessageContext } from '~/Providers';
import { useLocalize } from '~/hooks';

jest.mock('~/data-provider', () => ({
  useGetSteelMarkdownVersionsQuery: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.fn(),
}));

jest.mock('@librechat/client', () => ({
  Tag: ({ label, variant }: { label: string; variant: string }) => (
    <span data-testid="steel-version-tag" data-variant={variant}>
      {label}
    </span>
  ),
}));

jest.mock('./Customer', () => ({
  __esModule: true,
  default: () => <button type="button" data-testid="steel-customer-edit" />,
}));

const mockUseGetSteelMarkdownVersionsQuery = useGetSteelMarkdownVersionsQuery as jest.Mock;
const mockUseLocalize = useLocalize as jest.Mock;

const owner = (outputId: string, title: string) => ({
  outputId,
  title,
});

const message = (metadata: Record<string, unknown>): TMessage => ({
  messageId: 'message-1',
  conversationId: 'conversation-1',
  parentMessageId: null,
  text: '## ocr_result\n\n| 品名 |\n| --- |\n| 鋼板 |',
  isCreatedByUser: false,
  metadata,
});

const version = (overrides: Partial<SteelMarkdownVersion>): SteelMarkdownVersion => ({
  kind: 'ocr_result',
  messageId: 'message-1',
  title: 'ocr_result',
  outputId: 'ocr:new',
  revision: 'revision-1',
  latest: true,
  saves: 0,
  ...overrides,
});

function renderHeading({
  versions,
  metadata,
  title = 'ocr_result',
}: {
  versions: SteelMarkdownVersion[];
  metadata: Record<string, unknown>;
  title?: string;
}) {
  mockUseGetSteelMarkdownVersionsQuery.mockReturnValue({
    data: { versions },
    refetch: jest.fn(),
  });
  const currentMessage = message(metadata);
  currentMessage.text = `## ${title}\n\n| 品名 |\n| --- |\n| 鋼板 |`;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SteelVersionsProvider
        conversationId="conversation-1"
        messages={[currentMessage]}
        isSubmitting={false}
      >
        <MessageContext.Provider
          value={{
            messageId: currentMessage.messageId,
            isExpanded: false,
          }}
        >
          <SteelHeading>{title}</SteelHeading>
        </MessageContext.Provider>
      </SteelVersionsProvider>
    </QueryClientProvider>,
  );
}

describe('SteelHeading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalize.mockReturnValue(
      (key: string) =>
        ({
          com_ui_steel_review_latest_version: 'Latest version',
          com_ui_steel_review_previous_version: 'Previous version',
        })[key],
    );
  });

  it('shows the latest version label and successful save count for the bound current owner', () => {
    renderHeading({
      metadata: { steelMarkdownOwners: { ocr_result: owner('ocr:new', 'ocr_result') } },
      versions: [version({ outputId: 'ocr:new', saves: 2 })],
    });

    expect(screen.getByTestId('steel-version-tag')).toHaveTextContent('Latest version v3');
    expect(screen.getByTestId('steel-version-tag')).toHaveAttribute('data-variant', 'success');
  });

  it('labels a regenerated response before its message metadata has refreshed', () => {
    renderHeading({ metadata: {}, versions: [version({ latest: true })] });
    expect(screen.getByTestId('steel-version-tag')).toHaveTextContent('Latest version');
  });

  it('keeps an older regenerated sibling labeled as previous', () => {
    renderHeading({ metadata: {}, versions: [version({ latest: false })] });
    expect(screen.getByTestId('steel-version-tag')).toHaveTextContent('Previous version');
  });

  it('does not replace a loaded owner with a different cached generation', () => {
    renderHeading({
      metadata: { steelMarkdownOwners: { ocr_result: owner('ocr:new', 'ocr_result') } },
      versions: [version({ outputId: 'ocr:old', latest: false })],
    });
    expect(screen.queryByTestId('steel-version-tag')).toBeNull();
  });

  it('refreshes versions and all review tables after regeneration completes', () => {
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const refetch = jest.fn();
    mockUseGetSteelMarkdownVersionsQuery.mockReturnValue({ data: { versions: [] }, refetch });
    const currentMessage = message({});
    const view = (isSubmitting: boolean) => (
      <QueryClientProvider client={queryClient}>
        <SteelVersionsProvider
          conversationId="conversation-1"
          messages={[currentMessage]}
          isSubmitting={isSubmitting}
        >
          <div />
        </SteelVersionsProvider>
      </QueryClientProvider>
    );
    const rendered = render(view(true));
    rendered.rerender(view(false));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith([QueryKeys.steelReview, 'conversation-1']);
  });

  it('binds the badge to the loaded message owner before using the cached version count', () => {
    renderHeading({
      metadata: { steelMarkdownOwners: { ocr_result: owner('ocr:new', 'ocr_result') } },
      versions: [
        version({ outputId: 'ocr:old', latest: false, saves: 3 }),
        version({ outputId: 'ocr:new', latest: true, saves: 0 }),
      ],
    });

    expect(screen.getByTestId('steel-version-tag')).toHaveTextContent('Latest version');
    expect(screen.getByTestId('steel-version-tag')).not.toHaveTextContent('v3');
  });

  it('shows history counts and preserves the exact source heading title', () => {
    renderHeading({
      metadata: { steelMarkdownOwners: { ocr_result: owner('ocr:history', 'ocr_result') } },
      versions: [version({ outputId: 'ocr:history', latest: false, saves: 3 })],
    });

    const heading = screen.getByRole('heading', { name: 'ocr_result Previous version v4' });
    expect(heading).toHaveAttribute('data-markdown-title', 'ocr_result');
    expect(screen.getByTestId('steel-version-tag')).toHaveAttribute('data-variant', 'neutral');
  });

  it('does not append a save count to customer data badges', () => {
    renderHeading({
      title: 'customer_data',
      metadata: { steelMarkdownOwners: { customer_data: owner('customer:new', 'customer_data') } },
      versions: [
        version({
          kind: 'customer_data',
          title: 'customer_data',
          outputId: 'customer:new',
          saves: 4,
        }),
      ],
    });

    expect(screen.getByTestId('steel-version-tag')).toHaveTextContent('Latest version');
    expect(screen.getByTestId('steel-version-tag')).not.toHaveTextContent('v4');
  });

  it('uses localized labels for both current and history badges', () => {
    mockUseLocalize.mockReturnValue(
      (key: string) =>
        ({
          com_ui_steel_review_latest_version: '最新版本',
          com_ui_steel_review_previous_version: '歷史版本',
        })[key],
    );

    renderHeading({
      metadata: { steelMarkdownOwners: { ocr_result: owner('ocr:new', 'ocr_result') } },
      versions: [version({ outputId: 'ocr:new', saves: 1 })],
    });
    expect(screen.getByTestId('steel-version-tag')).toHaveTextContent('最新版本 v2');

    cleanup();
    renderHeading({
      metadata: { steelMarkdownOwners: { ocr_result: owner('ocr:history', 'ocr_result') } },
      versions: [version({ outputId: 'ocr:history', latest: false, saves: 1 })],
    });
    expect(screen.getByTestId('steel-version-tag')).toHaveTextContent('歷史版本 v2');
  });
});
