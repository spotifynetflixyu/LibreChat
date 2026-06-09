import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import SteelOAuthChat from './SteelOAuthChat';

const mockSendSteelChat = jest.fn();
const mockStreamSteelChat = jest.fn();
const mockCreateSteelWorkbook = jest.fn();
const mockExportSteelWorkbook = jest.fn();
const mockPatchSteelFileAnalysisData = jest.fn();

const sheetIds = [
  'system_order',
  'quote_details',
  'summary',
  'manual_review',
  'price_sources',
  'interpretation_notes',
  'customer_quote',
] as const;

const sheetLabels = {
  quote_details: '報價明細',
  manual_review: '人工複核',
  customer_quote: '給客戶用',
} as const;

function createWorkbook(version: number, materialUnitPrice: number | null = null) {
  return {
    id: 'wb_1',
    version,
    sheets: sheetIds.map((sheetId) => ({
      id: sheetId,
      label: sheetLabels[sheetId as keyof typeof sheetLabels] ?? sheetId,
      columns: [
        { key: 'line_no', label: '項次', valueType: 'number', editable: false },
        { key: 'material_unit_price', label: '材料單價', valueType: 'currency', editable: true },
      ],
      rows: [{ id: 'line_1', cells: { line_no: 1, material_unit_price: materialUnitPrice } }],
    })),
  };
}

function createFileAnalysisData(version: number) {
  return {
    id: 'fad_1',
    conversationId: 'wb_1',
    workbookId: 'wb_1',
    version,
    status: 'draft',
    sourceFiles: [
      {
        fileId: 'file_c_png',
        filename: 'c.png',
        mediaType: 'image/png',
        pageCount: 1,
      },
    ],
    sheets: {
      file_analysis_data: {
        columns: [
          { key: 'source_file', label: '來源檔案', valueType: 'text' },
          { key: 'part_no', label: '件號', valueType: 'text' },
          { key: 'spec', label: '規格', valueType: 'text' },
        ],
        rows: [
          {
            id: 'row_pl1',
            sourceRef: {
              fileId: 'file_c_png',
              filename: 'c.png',
              mediaType: 'image/png',
              page: 1,
            },
            cells: {
              source_file: 'c.png p.1',
              part_no: 'PL1',
              spec: '367×323×12t',
            },
            confidence: 'medium',
            reviewStatus: 'pending_review',
            rowWarnings: [],
          },
        ],
      },
      manual_review: {
        columns: [{ key: 'item', label: '人工複核項目', valueType: 'text' }],
        rows: [
          {
            id: 'review_1',
            cells: { item: '孔洞數需人工確認' },
            confidence: 'low',
            reviewStatus: 'pending_review',
            rowWarnings: [],
          },
        ],
      },
      interpretation_notes: {
        columns: [{ key: 'note', label: '判讀備註', valueType: 'text' }],
        rows: [
          {
            id: 'note_1',
            cells: { note: '以 OCR 規則保留原圖文字。' },
            confidence: 'medium',
          },
        ],
      },
    },
  };
}

jest.mock('librechat-data-provider', () => ({
  requiredSteelFileAnalysisSheetIds: [
    'file_analysis_data',
    'manual_review',
    'interpretation_notes',
  ],
  dataService: {
    createSteelWorkbook: (...args: unknown[]) => mockCreateSteelWorkbook(...args),
    exportSteelWorkbook: (...args: unknown[]) => mockExportSteelWorkbook(...args),
    patchSteelFileAnalysisData: (...args: unknown[]) => mockPatchSteelFileAnalysisData(...args),
    sendSteelChat: (...args: unknown[]) => mockSendSteelChat(...args),
    streamSteelChat: (...args: unknown[]) => mockStreamSteelChat(...args),
  },
}));

describe('SteelOAuthChat', () => {
  beforeEach(() => {
    mockCreateSteelWorkbook.mockReset();
    mockCreateSteelWorkbook.mockResolvedValue({
      workbook: createWorkbook(1),
    });
    mockExportSteelWorkbook.mockReset();
    mockExportSteelWorkbook.mockResolvedValue(new ArrayBuffer(8));
    mockPatchSteelFileAnalysisData.mockReset();
    mockPatchSteelFileAnalysisData.mockResolvedValue({
      fileAnalysisData: createFileAnalysisData(2),
    });
    mockSendSteelChat.mockReset();
    mockSendSteelChat.mockResolvedValue({
      provider: 'openai_oauth_responses',
      model: 'gpt-5.5',
      text: 'file-ok',
      unsupportedSettings: [],
      warnings: [],
    });
    mockStreamSteelChat.mockReset();
    mockStreamSteelChat.mockImplementation(async (_payload, onEvent) => {
      onEvent({
        type: 'progress',
        stage: 'provider_request',
        message: '等待模型回覆',
      });
      onEvent({
        type: 'reasoning',
        summary: '先判斷口語材料，查 catalog key 後再查規則與價格。',
      });
      onEvent({
        type: 'lookup',
        status: 'started',
        toolName: 'lookup_catalog_families',
        message: 'lookup_catalog_families started',
      });
      onEvent({
        type: 'lookup',
        status: 'completed',
        toolName: 'lookup_catalog_families',
        message: 'lookup_catalog_families completed',
        ok: true,
      });
      onEvent({
        type: 'lookup',
        status: 'started',
        toolName: 'lookup_quote_rules',
        message: 'lookup_quote_rules started',
      });
      onEvent({
        type: 'lookup',
        status: 'completed',
        toolName: 'lookup_quote_rules',
        message: 'lookup_quote_rules completed',
        ok: true,
      });
      onEvent({
        type: 'tool',
        status: 'completed',
        toolName: 'patch_quote_workbook',
        message: 'patch_quote_workbook completed',
        ok: true,
      });
      const response = {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: 'file-ok',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({ type: 'done', response });
      return response;
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
      expect(mockStreamSteelChat).toHaveBeenCalledTimes(1);
    });
    expect(mockStreamSteelChat).toHaveBeenCalledWith(
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
      expect.any(Function),
    );
  });

  it('shows lookup/tool progress while streaming, then replaces it with the final answer', async () => {
    const user = userEvent.setup();
    let finishStream: (() => void) | undefined;

    mockStreamSteelChat.mockImplementationOnce(
      (_payload, onEvent) =>
        new Promise((resolve) => {
          onEvent({
            type: 'progress',
            stage: 'provider_request',
            message: '等待模型回覆',
          });
          onEvent({
            type: 'reasoning',
            summary: '先判斷口語材料，查 catalog key 後再查規則與價格。',
          });
          onEvent({
            type: 'lookup',
            status: 'started',
            toolName: 'lookup_catalog_families',
            message: 'lookup_catalog_families started',
          });
          onEvent({
            type: 'lookup',
            status: 'completed',
            toolName: 'lookup_catalog_families',
            message: 'lookup_catalog_families completed',
            ok: true,
          });
          onEvent({
            type: 'lookup',
            status: 'started',
            toolName: 'lookup_quote_rules',
            message: 'lookup_quote_rules started',
          });
          onEvent({
            type: 'lookup',
            status: 'completed',
            toolName: 'lookup_quote_rules',
            message: 'lookup_quote_rules completed',
            ok: true,
          });
          onEvent({
            type: 'tool',
            status: 'completed',
            toolName: 'patch_quote_workbook',
            message: 'patch_quote_workbook completed',
            ok: true,
          });
          finishStream = () => {
            const response = {
              provider: 'openai_oauth_responses',
              model: 'gpt-5.5',
              text: 'file-ok',
              unsupportedSettings: [],
              warnings: [],
            };
            onEvent({ type: 'done', response });
            resolve(response);
          };
        }),
    );

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    await user.type(screen.getByPlaceholderText('Message Steel'), 'C型鋼 C100 6M 一支多少');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('patch_quote_workbook completed');
    expect(screen.getByLabelText('Steel stream status')).toBeInTheDocument();
    expect(screen.getByText('等待模型回覆')).toBeInTheDocument();
    expect(
      screen.getByText('先判斷口語材料，查 catalog key 後再查規則與價格。'),
    ).toBeInTheDocument();
    expect(screen.getByText('lookup_catalog_families started')).toBeInTheDocument();
    expect(screen.getByText('lookup_catalog_families completed')).toBeInTheDocument();
    expect(screen.getByText('lookup_quote_rules started')).toBeInTheDocument();
    expect(screen.getByText('lookup_quote_rules completed')).toBeInTheDocument();
    expect(screen.getByText('patch_quote_workbook completed')).toBeInTheDocument();
    expect(mockStreamSteelChat).toHaveBeenCalledTimes(1);
    expect(mockSendSteelChat).not.toHaveBeenCalled();

    finishStream?.();

    await screen.findByText('file-ok');
    await waitFor(() => {
      expect(screen.queryByLabelText('Steel stream status')).not.toBeInTheDocument();
    });
  });

  it('does not submit when Enter confirms IME composition text', async () => {
    render(<SteelOAuthChat />);

    const input = await screen.findByPlaceholderText('Message Steel');
    fireEvent.change(input, { target: { value: 'ㄌㄨㄥˊ' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(mockStreamSteelChat).not.toHaveBeenCalled();
    expect(input).toHaveValue('ㄌㄨㄥˊ');

    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockStreamSteelChat).toHaveBeenCalledTimes(1);
    });
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
      expect(mockStreamSteelChat).toHaveBeenCalledTimes(1);
    });
    expect(mockStreamSteelChat).toHaveBeenCalledWith(
      expect.objectContaining({
        reasoningEffort: 'high',
      }),
      expect.any(Function),
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
      expect(mockStreamSteelChat).toHaveBeenCalledTimes(2);
    });
    expect(mockStreamSteelChat).toHaveBeenLastCalledWith(
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
      expect.any(Function),
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

  it('renders right panel Workbook, File Analysis, and Thinking tabs with sheet-table UX', async () => {
    const user = userEvent.setup();

    render(<SteelOAuthChat />);

    expect(await screen.findByRole('tab', { name: 'Workbook' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'File Analysis' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(screen.getByRole('tab', { name: 'Thinking' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('button', { name: '人工複核' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '人工複核清單' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'File Analysis' }));

    expect(screen.getByText('No file analysis yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '報價明細' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Thinking' }));

    expect(screen.getByText('Last run')).toBeInTheDocument();
    expect(screen.getByText('No run status yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '報價明細' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Workbook' }));

    expect(screen.getByRole('button', { name: '報價明細' })).toBeInTheDocument();
  });

  it('renders returned file analysis data in a dedicated right-panel tab', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已建立圖文判讀表格。',
        unsupportedSettings: [],
        warnings: [],
        fileAnalysisData: createFileAnalysisData(1),
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('tab', { name: 'Workbook' });
    await user.type(screen.getByPlaceholderText('Message Steel'), '判讀 c.png');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('已建立圖文判讀表格。');
    await user.click(screen.getByRole('tab', { name: 'File Analysis' }));

    expect(screen.getByText('File Analysis Data')).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('1 source file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'file_analysis_data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'manual_review' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'interpretation_notes' })).toBeInTheDocument();
    expect(screen.getByText('來源檔案')).toBeInTheDocument();
    expect(screen.getByText('PL1')).toBeInTheDocument();
    expect(screen.getByText('367×323×12t')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'manual_review' }));

    expect(screen.getByText('孔洞數需人工確認')).toBeInTheDocument();
  });

  it('lets users edit file_analysis_data cells and save manual patches', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已建立圖文判讀表格。',
        unsupportedSettings: [],
        warnings: [],
        fileAnalysisData: createFileAnalysisData(1),
      };
      onEvent({ type: 'done', response });
      return response;
    });
    mockPatchSteelFileAnalysisData.mockResolvedValueOnce({
      fileAnalysisData: {
        ...createFileAnalysisData(2),
        sheets: {
          ...createFileAnalysisData(2).sheets,
          file_analysis_data: {
            ...createFileAnalysisData(2).sheets.file_analysis_data,
            rows: [
              {
                ...createFileAnalysisData(2).sheets.file_analysis_data.rows[0],
                cells: {
                  source_file: 'c.png p.1',
                  part_no: 'PL7',
                  spec: '367×323×12t',
                },
              },
            ],
          },
        },
      },
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('tab', { name: 'Workbook' });
    await user.type(screen.getByPlaceholderText('Message Steel'), '判讀 c.png');
    await user.click(screen.getByLabelText('Send'));
    await user.click(await screen.findByRole('tab', { name: 'File Analysis' }));

    await user.dblClick(screen.getByText('PL1'));
    const input = screen.getByDisplayValue('PL1');
    await user.clear(input);
    await user.type(input, 'PL7');
    await user.keyboard('{Enter}');

    expect(screen.getByText('draft · 1 unsaved change')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save file analysis changes' }));

    expect(mockPatchSteelFileAnalysisData).toHaveBeenCalledWith('fad_1', {
      conversationId: 'wb_1',
      workbookId: 'wb_1',
      sourceFiles: [
        { fileId: 'file_c_png', filename: 'c.png', mediaType: 'image/png', pageCount: 1 },
      ],
      patches: [
        expect.objectContaining({
          sheetId: 'file_analysis_data',
          upsertRows: [
            expect.objectContaining({
              id: 'row_pl1',
              cells: expect.objectContaining({ part_no: 'PL7' }),
            }),
          ],
        }),
      ],
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save file analysis changes' })).toBeDisabled();
    });
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('lets users add and delete file_analysis_data rows before saving', async () => {
    const user = userEvent.setup();
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: '已建立圖文判讀表格。',
        unsupportedSettings: [],
        warnings: [],
        fileAnalysisData: createFileAnalysisData(1),
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('tab', { name: 'Workbook' });
    await user.type(screen.getByPlaceholderText('Message Steel'), '判讀 c.png');
    await user.click(screen.getByLabelText('Send'));
    await user.click(await screen.findByRole('tab', { name: 'File Analysis' }));

    await user.click(screen.getByRole('button', { name: 'Add file analysis row' }));
    await user.click(screen.getByRole('button', { name: 'Delete file analysis row row_pl1' }));

    expect(screen.getByText('draft · 2 unsaved changes')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save file analysis changes' }));

    expect(mockPatchSteelFileAnalysisData).toHaveBeenCalledWith(
      'fad_1',
      expect.objectContaining({
        patches: [
          expect.objectContaining({
            sheetId: 'file_analysis_data',
            deleteRowIds: ['row_pl1'],
            upsertRows: [
              expect.objectContaining({
                id: expect.stringMatching(/^manual_row_/),
              }),
            ],
          }),
        ],
      }),
    );
  });

  it('smokes image OCR to manual file_analysis_data correction to the next chat turn', async () => {
    const user = userEvent.setup();
    const imageFile = new File(['PNG_SENTINEL_FOR_OCR'], 'c.png', { type: 'image/png' });
    const correctedFileAnalysisData = {
      ...createFileAnalysisData(2),
      sheets: {
        ...createFileAnalysisData(2).sheets,
        file_analysis_data: {
          ...createFileAnalysisData(2).sheets.file_analysis_data,
          rows: [
            {
              ...createFileAnalysisData(2).sheets.file_analysis_data.rows[0],
              cells: {
                source_file: 'c.png p.1',
                part_no: 'PL7',
                spec: '367×323×12t',
              },
            },
          ],
        },
      },
    };
    mockStreamSteelChat
      .mockImplementationOnce(async (_payload, onEvent) => {
        const response = {
          provider: 'openai_oauth_responses',
          model: 'gpt-5.5',
          text: '已用 OCR 建立 c.png 圖文判讀表格。',
          unsupportedSettings: [],
          warnings: [],
          fileAnalysisData: createFileAnalysisData(1),
        };
        onEvent({ type: 'done', response });
        return response;
      })
      .mockImplementationOnce(async (_payload, onEvent) => {
        const response = {
          provider: 'openai_oauth_responses',
          model: 'gpt-5.5',
          text: '已依照最新修正後的 file_analysis_data 繼續判讀。',
          unsupportedSettings: [],
          warnings: [],
        };
        onEvent({ type: 'done', response });
        return response;
      });
    mockPatchSteelFileAnalysisData.mockResolvedValueOnce({
      fileAnalysisData: correctedFileAnalysisData,
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('tab', { name: 'Workbook' });
    await user.upload(screen.getByLabelText('Attach files'), imageFile);
    await user.type(screen.getByPlaceholderText('Message Steel'), 'OCR 判讀 c.png');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('已用 OCR 建立 c.png 圖文判讀表格。');
    expect(mockStreamSteelChat).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messages: [
          {
            role: 'user',
            content: 'OCR 判讀 c.png',
            files: [
              {
                filename: 'c.png',
                mediaType: 'image/png',
                dataBase64: 'UE5HX1NFTlRJTkVMX0ZPUl9PQ1I=',
              },
            ],
          },
        ],
      }),
      expect.any(Function),
    );

    await user.click(screen.getByRole('tab', { name: 'File Analysis' }));
    await user.dblClick(screen.getByText('PL1'));
    const input = screen.getByDisplayValue('PL1');
    await user.clear(input);
    await user.type(input, 'PL7');
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Save file analysis changes' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Save file analysis changes' })).toBeDisabled();
    });
    expect(screen.getByText('PL7')).toBeInTheDocument();
    expect(mockPatchSteelFileAnalysisData).toHaveBeenCalledWith(
      'fad_1',
      expect.objectContaining({
        conversationId: 'wb_1',
        patches: [
          expect.objectContaining({
            sheetId: 'file_analysis_data',
            upsertRows: [
              expect.objectContaining({
                id: 'row_pl1',
                cells: expect.objectContaining({ part_no: 'PL7' }),
              }),
            ],
          }),
        ],
      }),
    );

    await user.type(screen.getByPlaceholderText('Message Steel'), '用修正後資料繼續判讀');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('已依照最新修正後的 file_analysis_data 繼續判讀。');
    expect(mockStreamSteelChat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        conversationId: 'wb_1',
        workbookId: 'wb_1',
        messages: expect.arrayContaining([
          {
            role: 'user',
            content: '用修正後資料繼續判讀',
          },
        ]),
      }),
      expect.any(Function),
    );
  });

  it('keeps only the last run thinking status in the right panel and includes errors', async () => {
    const user = userEvent.setup();

    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      onEvent({
        type: 'progress',
        stage: 'provider_request',
        message: 'first run waiting',
      });
      onEvent({
        type: 'reasoning',
        summary: 'first run reasoning summary',
      });
      onEvent({
        type: 'lookup',
        status: 'completed',
        toolName: 'lookup_catalog_families',
        message: 'first catalog completed',
        ok: true,
      });
      const response = {
        provider: 'openai_oauth_responses',
        model: 'gpt-5.5',
        text: 'first-ok',
        unsupportedSettings: [],
        warnings: [],
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('tab', { name: 'Workbook' });
    await user.type(screen.getByPlaceholderText('Message Steel'), 'first run');
    await user.click(screen.getByLabelText('Send'));
    await screen.findByText('first-ok');

    await user.click(screen.getByRole('tab', { name: 'Thinking' }));

    let thinkingPanel = screen.getByLabelText('Thinking status panel');
    expect(within(thinkingPanel).getByText('Last run')).toBeInTheDocument();
    expect(within(thinkingPanel).getByText('first run reasoning summary')).toBeInTheDocument();
    expect(within(thinkingPanel).getByText('first catalog completed')).toBeInTheDocument();

    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      onEvent({
        type: 'progress',
        stage: 'provider_request',
        message: 'second run waiting',
      });
      onEvent({
        type: 'error',
        errorCategory: 'provider_timeout',
        errorSummary: 'second run provider timeout',
      });
      throw new Error('second run provider timeout');
    });

    await user.type(screen.getByPlaceholderText('Message Steel'), 'second run');
    await user.click(screen.getByLabelText('Send'));

    await waitFor(() => {
      expect(screen.getAllByText('second run provider timeout').length).toBeGreaterThanOrEqual(2);
    });
    thinkingPanel = screen.getByLabelText('Thinking status panel');

    expect(within(thinkingPanel).getByText('second run waiting')).toBeInTheDocument();
    expect(within(thinkingPanel).getByText('second run provider timeout')).toBeInTheDocument();
    expect(
      within(thinkingPanel).queryByText('first run reasoning summary'),
    ).not.toBeInTheDocument();
    expect(within(thinkingPanel).queryByText('first catalog completed')).not.toBeInTheDocument();
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
    mockStreamSteelChat.mockImplementationOnce(async (_payload, onEvent) => {
      const response = {
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
      };
      onEvent({ type: 'done', response });
      return response;
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    expect(screen.getByRole('button', { name: '給客戶用' })).toBeInTheDocument();
    expect(screen.getByText('v1')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Message Steel'), '把 line 1 材料單價改成 115');
    await user.click(screen.getByLabelText('Send'));

    await screen.findByText('已更新：報價明細 line-1 材料單價 -> 115');
    expect(await screen.findByText('115')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(mockStreamSteelChat).toHaveBeenCalledWith(
      expect.objectContaining({
        workbookId: 'wb_1',
        workbookVersion: 1,
      }),
      expect.any(Function),
    );
  });

  it('downloads the current workbook as XLSX with arbitrary selected sheets', async () => {
    const user = userEvent.setup();
    const createObjectURL = jest.fn(() => 'blob:steel-workbook');
    const revokeObjectURL = jest.fn();
    const anchorClick = jest.fn();
    const originalCreateElement = document.createElement.bind(document);
    const createElementSpy = jest.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        element.click = anchorClick;
      }
      return element;
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    render(<SteelOAuthChat />);

    await screen.findByRole('button', { name: '報價明細' });
    await user.click(screen.getByRole('checkbox', { name: 'Export system_order' }));
    await user.click(screen.getByRole('button', { name: 'Download XLSX' }));

    expect(mockExportSteelWorkbook).toHaveBeenCalledWith('wb_1', {
      workbookVersion: 1,
      sheetIds: [
        'quote_details',
        'summary',
        'manual_review',
        'price_sources',
        'interpretation_notes',
        'customer_quote',
      ],
    });
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:steel-workbook');

    createElementSpy.mockRestore();
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
