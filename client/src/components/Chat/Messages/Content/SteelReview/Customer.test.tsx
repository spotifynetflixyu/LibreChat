import React, { useCallback, useState } from 'react';
import userEvent from '@testing-library/user-event';
import { ContentTypes } from 'librechat-data-provider';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  SteelCustomerResponse,
  SteelCustomerSaveResponse,
  SteelMarkdownVersion,
} from 'librechat-data-provider';
import type { TranslationKeys } from '~/hooks';
import { useCommitSteelCustomerMutation, useGetSteelCustomerQuery } from '~/data-provider';
import { useMessageContext } from '~/Providers';
import SteelCustomer from './Customer';
import { useLocalize } from '~/hooks';

jest.mock('~/data-provider', () => ({
  useCommitSteelCustomerMutation: jest.fn(),
  useGetSteelCustomerQuery: jest.fn(),
}));

jest.mock('~/Providers', () => ({
  useMessageContext: jest.fn(),
}));

jest.mock('~/hooks', () => ({
  useLocalize: jest.fn(),
}));

const mockUseCommitSteelCustomerMutation = useCommitSteelCustomerMutation as jest.Mock;
const mockUseGetSteelCustomerQuery = useGetSteelCustomerQuery as jest.Mock;
const mockUseMessageContext = useMessageContext as jest.Mock;
const mockUseLocalize = useLocalize as jest.Mock;

const input = {
  conversationId: 'conversation-1',
  messageId: 'message-1',
  title: 'customer_data',
  outputId: 'customer-1',
};

const customer = (overrides: Partial<SteelCustomerResponse> = {}): SteelCustomerResponse => ({
  ...input,
  revision: 'revision-1',
  tier: 'A',
  latest: true,
  ...overrides,
});

const version = (
  latest = true,
): Pick<SteelMarkdownVersion, 'messageId' | 'outputId' | 'title' | 'latest' | 'revision'> => ({
  messageId: input.messageId,
  outputId: input.outputId,
  title: input.title,
  revision: 'revision-1',
  latest,
});

const savedCustomer: SteelCustomerSaveResponse = {
  ...customer({ tier: 'F', revision: 'revision-2' }),
  message: {
    messageId: input.messageId,
    text: 'saved customer data',
    content: [{ type: ContentTypes.TEXT, text: 'saved customer data' }],
  },
};

let query: {
  data?: SteelCustomerResponse;
  error?: unknown;
  isFetching: boolean;
  refetch: jest.Mock;
};
let saveMutation: jest.Mock;
let holdSave = false;
let resolveSave: ((value: SteelCustomerSaveResponse) => void) | undefined;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
});

function useTestCommitMutation() {
  const [isLoading, setIsLoading] = useState(false);
  const reset = useCallback(() => {
    if (!holdSave) {
      setIsLoading(false);
    }
  }, []);
  const mutateAsync = useCallback((value: unknown) => {
    saveMutation(value);
    if (!holdSave) {
      return Promise.resolve(savedCustomer);
    }
    setIsLoading(true);
    return new Promise<SteelCustomerSaveResponse>((resolve) => {
      resolveSave = (result) => {
        setIsLoading(false);
        resolve(result);
      };
    });
  }, []);
  return { error: query.error, isLoading, mutateAsync, reset };
}

function renderCustomer(latest = true) {
  return render(<SteelCustomer version={version(latest)} getInitialTier={() => query.data?.tier} />);
}

describe('SteelCustomer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query = { data: customer(), error: null, isFetching: false, refetch: jest.fn() };
    saveMutation = jest.fn();
    holdSave = false;
    resolveSave = undefined;
    mockUseMessageContext.mockReturnValue({
      conversationId: input.conversationId,
      isSubmitting: false,
    });
    mockUseGetSteelCustomerQuery.mockImplementation(() => query);
    mockUseCommitSteelCustomerMutation.mockImplementation(useTestCommitMutation);
    mockUseLocalize.mockReturnValue((key: TranslationKeys) => key);
  });

  it('keeps the historical edit icon disabled', () => {
    renderCustomer(false);
    expect(screen.getByTestId('steel-customer-edit')).toBeDisabled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('loads the latest tier, allows reselection, and cancels without saving', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const selectTrigger = screen.getByRole('combobox', { name: 'com_ui_steel_customer_tier' });
    expect(selectTrigger).toHaveTextContent('A');
    await user.click(selectTrigger);
    await user.click(await screen.findByRole('option', { name: 'C' }));
    expect(selectTrigger).toHaveTextContent('C');
    await user.click(screen.getByRole('button', { name: 'com_ui_cancel' }));

    expect(saveMutation).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens immediately with the Markdown tier without reading the backend', async () => {
    const user = userEvent.setup();
    query.isFetching = true;
    renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));
    expect(screen.getByRole('combobox', { name: 'com_ui_steel_customer_tier' })).toHaveTextContent('A');
    expect(screen.getByRole('button', { name: 'com_ui_confirm' })).toBeEnabled();
    expect(screen.queryByText('com_ui_loading')).toBeNull();
    expect(mockUseGetSteelCustomerQuery).not.toHaveBeenCalled();
  });

  it('rejects a missing Markdown tier without assuming a default', async () => {
    const user = userEvent.setup();
    query.data = undefined;
    renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_customer_invalid_table');
    expect(screen.getByRole('button', { name: 'com_ui_confirm' })).toBeDisabled();
    expect(mockUseGetSteelCustomerQuery).not.toHaveBeenCalled();
  });

  it('confirms the selected tier with the current revision', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));
    const selectTrigger = screen.getByRole('combobox', { name: 'com_ui_steel_customer_tier' });
    await user.click(selectTrigger);
    await user.click(await screen.findByRole('option', { name: 'F' }));
    await user.click(screen.getByRole('button', { name: 'com_ui_confirm' }));

    await waitFor(() =>
      expect(saveMutation).toHaveBeenCalledWith({
        ...input,
        revision: 'revision-1',
        tier: 'F',
        expectedTier: 'A',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('keeps a conflict visible without issuing a background read', async () => {
    const user = userEvent.setup();
    query.error = { response: { data: { code: 'CUSTOMER_CONFLICT' } } };
    renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));

    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_steel_customer_conflict');
    expect(screen.getByRole('button', { name: 'com_ui_confirm' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'com_ui_retry' })).toBeNull();
    expect(mockUseGetSteelCustomerQuery).not.toHaveBeenCalled();
    expect(saveMutation).not.toHaveBeenCalled();
  });

  it('blocks cancellation and duplicate confirms while saving', async () => {
    const user = userEvent.setup();
    holdSave = true;
    renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));
    const confirm = screen.getByRole('button', { name: 'com_ui_confirm' });
    await user.click(confirm);
    await waitFor(() => expect(saveMutation).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('button', { name: 'com_ui_cancel' })).toBeDisabled();
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveTextContent('com_ui_updating');
    fireEvent.click(confirm);
    expect(saveMutation).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSave?.(savedCustomer);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('prevents outside and Escape dismissal', async () => {
    const user = userEvent.setup();
    renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));

    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables the editor while chat is streaming', async () => {
    const user = userEvent.setup();
    const rendered = renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));
    mockUseMessageContext.mockReturnValue({
      conversationId: input.conversationId,
      isSubmitting: true,
    });
    rendered.rerender(<SteelCustomer version={version()} getInitialTier={() => query.data?.tier} />);

    expect(screen.getByRole('combobox', { name: 'com_ui_steel_customer_tier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'com_ui_confirm' })).toBeDisabled();
  });

  it('disables the editor if the version becomes historical while open', async () => {
    const user = userEvent.setup();
    const rendered = renderCustomer();
    await user.click(screen.getByTestId('steel-customer-edit'));
    rendered.rerender(<SteelCustomer version={version(false)} getInitialTier={() => query.data?.tier} />);

    expect(screen.getByText('com_ui_steel_customer_historical')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'com_ui_steel_customer_tier' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'com_ui_confirm' })).toBeDisabled();
  });
});
