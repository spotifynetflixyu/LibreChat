const mockCallTool = jest.fn();
const mockClose = jest.fn();
const mockConnect = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    callTool: mockCallTool,
    close: mockClose,
    connect: mockConnect,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation((options) => ({ options })),
}));

import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getSteelFileBytes, runSteelFileOcr } from './ocr';

const mockStdioClientTransport = StdioClientTransport as jest.Mock;

describe('Steel OCR file bytes', () => {
  beforeEach(() => {
    mockCallTool.mockReset();
    mockCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '| 品名 | 數量 |\n| --- | --- |\n| PL6 | 2 |' }],
    });
    mockClose.mockReset();
    mockConnect.mockReset();
    mockStdioClientTransport.mockClear();
    process.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN = 'test-token';
    delete process.env.PADDLEOCR_MCP_PPOCR_SOURCE;
    delete process.env.PADDLEOCR_MCP_QIANFAN_API_KEY;
  });

  afterEach(() => {
    delete process.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN;
    delete process.env.PADDLEOCR_MCP_PPOCR_SOURCE;
    delete process.env.PADDLEOCR_MCP_QIANFAN_API_KEY;
  });

  it('copies Uint8Array source bytes before OCR processing can transfer them', () => {
    const source = new Uint8Array([1, 2, 3]);

    const bytes = getSteelFileBytes({
      filename: 'drawing.pdf',
      mediaType: 'application/pdf',
      data: source,
    });

    expect(bytes).toEqual(source);
    expect(bytes).not.toBe(source);

    bytes[0] = 9;
    expect(source[0]).toBe(1);
  });

  it('sends one PDF file to PaddleOCR MCP once instead of rendering per-page images', async () => {
    const result = await runSteelFileOcr({
      arguments: {
        fileIndex: 0,
        output_mode: 'markdown',
      },
      files: [
        {
          filename: 'drawing.pdf',
          mediaType: 'application/pdf',
          data: new Uint8Array([37, 80, 68, 70]),
        },
      ],
      providerToolCallId: 'call_pdf_ocr',
    });

    expect(result.ok).toBe(true);
    expect(mockCallTool).toHaveBeenCalledTimes(1);
    expect(mockCallTool.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        name: 'paddleocr_vl',
        arguments: expect.objectContaining({
          file_type: 'pdf',
          output_mode: 'markdown',
          return_images: false,
        }),
      }),
    );
    expect(mockCallTool.mock.calls[0]?.[0].arguments.input_data).toMatch(/drawing\.pdf$/);
    if (result.ok) {
      expect(result.data).toEqual(
        expect.objectContaining({
          filename: 'drawing.pdf',
          fileType: 'pdf',
          outputMode: 'markdown',
          text: expect.stringContaining('PL6'),
        }),
      );
      expect(result.data).not.toHaveProperty('page');
    }
  });

  it('uses Qianfan provider when Qianfan API key is set and source is blank', async () => {
    delete process.env.PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN;
    process.env.PADDLEOCR_MCP_QIANFAN_API_KEY = 'qianfan-key';

    const result = await runSteelFileOcr({
      arguments: {
        fileIndex: 0,
        output_mode: 'markdown',
      },
      files: [
        {
          filename: 'drawing.png',
          mediaType: 'image/png',
          data: new Uint8Array([137, 80, 78, 71]),
        },
      ],
      providerToolCallId: 'call_png_ocr',
    });

    expect(result.ok).toBe(true);
    expect(mockStdioClientTransport).toHaveBeenCalledTimes(1);
    expect(mockStdioClientTransport.mock.calls[0]?.[0].env).toEqual(
      expect.objectContaining({
        PADDLEOCR_MCP_MODEL: 'PaddleOCR-VL',
        PADDLEOCR_MCP_PPOCR_SOURCE: 'qianfan',
        PADDLEOCR_MCP_QIANFAN_API_KEY: 'qianfan-key',
      }),
    );
    expect(mockStdioClientTransport.mock.calls[0]?.[0].env).not.toHaveProperty(
      'PADDLEOCR_MCP_AISTUDIO_ACCESS_TOKEN',
    );
  });
});
