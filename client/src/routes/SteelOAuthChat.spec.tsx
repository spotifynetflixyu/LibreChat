import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SteelOAuthChat from './SteelOAuthChat';

const mockSendSteelChat = jest.fn();
const mockCreateSteelWorkbook = jest.fn();

const sheetIds = [
  'quote_details',
  'summary',
  'manual_review',
  'price_sources',
  'interpretation_notes',
  'system_order',
  'customer_quote',
] as const;

function createWorkbook(version: number, materialUnitPrice: number | null = null) {
  return {
    id: 'wb_1',
    version,
    sheets: sheetIds.map((sheetId) => ({
      id: sheetId,
      label:
        sheetId === 'quote_details'
          ? '報價明細'
          : sheetId === 'customer_quote'
            ? '給客戶'
            : sheetId,
      columns: [
        { key: 'line_no', label: '項次', valueType: 'number', editable: false },
        { key: 'material_unit_price', label: '材料單價', valueType: 'currency', editable: true },
      ],
      rows: [{ id: 'line_1', cells: { line_no: 1, material_unit_price: materialUnitPrice } }],
    })),
  };
}

jest.mock('librechat-data-provider', () => ({
  dataService: {
    createSteelWorkbook: (...args: unknown[]) => mockCreateSteelWorkbook(...args),
    sendSteelChat: (...args: unknown[]) => mockSendSteelChat(...args),
  },
}));

describe('SteelOAuthChat', () => {
  beforeEach(() => {
    mockCreateSteelWorkbook.mockReset();
    mockCreateSteelWorkbook.mockResolvedValue({
      workbook: createWorkbook(1),
    });
    mockSendSteelChat.mockReset();
    mockSendSteelChat.mockResolvedValue({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'file-ok',
      unsupportedSettings: [],
      warnings: [],
    });
  });

  it('sends selected files as browser-safe base64 payloads', async () => {
    const user = userEvent.setup();
    const file = new File(['Steel OAuth capability smoke'], 'steel-oauth-smoke.txt', {
      type: 'text/plain',
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    await user.upload(screen.getByLabelText('Attach files'), file);
    await user.type(screen.getByPlaceholderText('Message Steel'), 'Read the attachment.');
    await user.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(mockSendSteelChat).toHaveBeenCalledTimes(1);
    });
    expect(mockSendSteelChat).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.5',
        reasoningEffort: 'medium',
        workbookId: 'wb_1',
        workbookVersion: 1,
        messages: [
          {
            role: 'user',
            content: 'Read the attachment.',
            files: [
              {
                filename: 'steel-oauth-smoke.txt',
                mediaType: 'text/plain',
                dataBase64: 'U3RlZWwgT0F1dGggY2FwYWJpbGl0eSBzbW9rZQ==',
              },
            ],
          },
        ],
      }),
    );
  });

  it('uses gpt-5.5 without rendering a model selector', async () => {
    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });

    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'gpt-5.4' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'gpt-5.5' })).not.toBeInTheDocument();
  });

  it('sends the selected reasoning effort with each chat request', async () => {
    const user = userEvent.setup();

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    await user.click(screen.getByRole('button', { name: 'high' }));
    await user.type(screen.getByPlaceholderText('Message Steel'), 'Read carefully.');
    await user.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(mockSendSteelChat).toHaveBeenCalledTimes(1);
    });
    expect(mockSendSteelChat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: 'high',
      }),
    );
  });

  it('starts a new local chat without changing the selected reasoning effort', async () => {
    const user = userEvent.setup();

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    await user.click(screen.getByRole('button', { name: 'xhigh' }));
    await user.type(screen.getByPlaceholderText('Message Steel'), 'First message.');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('file-ok');

    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(screen.queryByText('First message.')).not.toBeInTheDocument();
    expect(screen.queryByText('file-ok')).not.toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Message Steel'), 'Second message.');
    await user.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(mockSendSteelChat).toHaveBeenCalledTimes(2);
    });
    expect(mockSendSteelChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        model: 'gpt-5.5',
        reasoningEffort: 'xhigh',
        workbookId: 'wb_1',
        workbookVersion: 1,
        messages: [
          {
            role: 'user',
            content: 'Second message.',
          },
        ],
      }),
    );
  });

  it('toggles the workbook panel from the header icon without clearing workbook state', async () => {
    const user = userEvent.setup();

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    expect(screen.getByLabelText('Workbook panel')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide workbook' }));

    expect(screen.queryByLabelText('Workbook panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show workbook' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show workbook' }));

    expect(await screen.findByRole('button', { name: '報價明細' })).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
  });

  it('resizes the workbook panel with the divider and clamps the approved width limits', async () => {
    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });

    const layout = screen.getByTestId('steel-workbook-layout');
    Object.defineProperty(layout, 'clientWidth', { configurable: true, value: 1000 });
    layout.getBoundingClientRect = () =>
      ({
        bottom: 720,
        height: 720,
        left: 0,
        right: 1000,
        top: 0,
        width: 1000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    const panel = screen.getByLabelText('Workbook panel');
    const divider = screen.getByRole('separator', { name: 'Resize workbook panel' });

    fireEvent.mouseDown(divider, { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: 300 });

    expect(panel).toHaveStyle({ width: '700px' });

    fireEvent.mouseMove(window, { clientX: 50 });
    expect(panel).toHaveStyle({ width: '800px' });

    fireEvent.mouseMove(window, { clientX: 990 });
    expect(panel).toHaveStyle({ width: '100px' });

    fireEvent.mouseUp(window);
  });

  it('renders seven workbook tabs and refreshes the preview from a later chat patch', async () => {
    const user = userEvent.setup();
    mockSendSteelChat.mockResolvedValueOnce({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.4',
      text: '已更新：報價明細 line-1 材料單價 -> 115',
      unsupportedSettings: [],
      warnings: [],
      workbookPatch: {
        workbook: createWorkbook(2, 115),
        changedPaths: [
          { sheetId: 'quote_details', rowId: 'line_1', columnKey: 'material_unit_price' },
        ],
        changedFieldSummary: [
          {
            sheetId: 'quote_details',
            rowId: 'line_1',
            columnKey: 'material_unit_price',
            label: '材料單價',
            previousValue: null,
            nextValue: 115,
          },
        ],
      },
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    expect(screen.getByRole('button', { name: '給客戶' })).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Message Steel'), '把 line 1 材料單價改成 115');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('已更新：報價明細 line-1 材料單價 -> 115');
    expect(await screen.findByText('115')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(mockSendSteelChat).toHaveBeenCalledWith(
      expect.objectContaining({
        workbookId: 'wb_1',
        workbookVersion: 1,
      }),
    );
  });

  it('shows a retryable workbook error instead of staying on loading', async () => {
    const user = userEvent.setup();
    mockCreateSteelWorkbook.mockRejectedValueOnce(new Error('Workbook API down'));

    render(<SteelOAuthChat />);

    expect(await screen.findByText('Workbook API down')).toBeInTheDocument();
    expect(screen.queryByText('Workbook loading')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry workbook' }));

    expect(mockCreateSteelWorkbook).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: '報價明細' })).toBeInTheDocument();
  });
});
