import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCPConnection } from '../connection';
import type { StdioOptions } from '../types';

describe('MCP stderr capture', () => {
  function createConnection() {
    return new MCPConnection({
      serverName: 'PaddleOCR',
      serverConfig: {
        type: 'stdio',
        command: 'paddleocr_mcp',
        args: [],
      } as StdioOptions,
    });
  }

  function attach(connection: MCPConnection, transport: StdioClientTransport) {
    const internals = connection as unknown as {
      attachStderrCapture: (transport: StdioClientTransport, enabled: boolean) => void;
    };
    internals.attachStderrCapture(transport, true);
  }

  it('captures split lines after an exclusive cursor', () => {
    const connection = createConnection();
    const transport = new StdioClientTransport({
      command: 'paddleocr_mcp',
      args: [],
      stderr: 'pipe',
    });
    attach(connection, transport);
    const cursor = connection.getStderrCursor();
    transport.stderr?.emit('data', Buffer.from('HTTP 4'));
    transport.stderr?.emit('data', Buffer.from('29 too many requests\nnext'));

    expect(connection.readStderrSince(cursor)).toBe('HTTP 429 too many requests\nnext');
  });

  it('keeps capture bounded and cleans listeners', () => {
    const connection = createConnection();
    const transport = new StdioClientTransport({
      command: 'paddleocr_mcp',
      args: [],
      stderr: 'pipe',
    });
    attach(connection, transport);
    const cursor = connection.getStderrCursor();
    for (let index = 0; index < 100; index += 1) {
      transport.stderr?.emit('data', `${index}:${'x'.repeat(1000)}\n`);
    }

    expect(connection.readStderrSince(cursor).length).toBeLessThanOrEqual(32 * 1024 + 63);
    const internals = connection as unknown as { clearStderrCapture: () => void };
    internals.clearStderrCapture();
    expect(connection.hasStderrCapture()).toBe(false);
    expect(connection.readStderrSince(cursor)).toBe('');
  });

  it('bounds stderr that never emits a newline', () => {
    const connection = createConnection();
    const transport = new StdioClientTransport({
      command: 'paddleocr_mcp',
      args: [],
      stderr: 'pipe',
    });
    attach(connection, transport);
    const cursor = connection.getStderrCursor();

    transport.stderr?.emit('data', 'x'.repeat(100 * 1024));

    expect(connection.readStderrSince(cursor)).toHaveLength(32 * 1024);
  });

  it('bounds an unterminated trailing segment after a newline', () => {
    const connection = createConnection();
    const transport = new StdioClientTransport({
      command: 'paddleocr_mcp',
      args: [],
      stderr: 'pipe',
    });
    attach(connection, transport);
    const cursor = connection.getStderrCursor();
    transport.stderr?.emit('data', 'line\n');
    transport.stderr?.emit('data', 'x'.repeat(100 * 1024));

    const internals = connection as unknown as {
      stderrCapture: { pending: string } | null;
    };
    expect(internals.stderrCapture?.pending.length).toBeLessThanOrEqual(32 * 1024);
    expect(connection.readStderrSince(cursor).length).toBeLessThanOrEqual(32 * 1024);
  });

  it('defaults PaddleOCR stdio to piped stderr while honoring explicit ignore', async () => {
    const paddleConnection = createConnection();
    const construct = (connection: MCPConnection, options: StdioOptions) =>
      (connection as unknown as {
        constructTransport: (options: StdioOptions) => Promise<StdioClientTransport>;
      }).constructTransport(options);
    const paddleTransport = await construct(paddleConnection, {
      type: 'stdio',
      command: 'paddleocr_mcp',
      args: [],
    } as StdioOptions);
    expect(paddleTransport.stderr).not.toBeNull();

    const ignoredTransport = await construct(paddleConnection, {
      type: 'stdio',
      command: 'paddleocr_mcp',
      args: [],
      stderr: 'ignore',
    } as StdioOptions);
    expect(ignoredTransport.stderr).toBeNull();

    const genericConnection = new MCPConnection({
      serverName: 'OtherServer',
      serverConfig: {
        type: 'stdio',
        command: 'other_mcp',
        args: [],
      } as StdioOptions,
    });
    const genericTransport = await construct(genericConnection, {
      type: 'stdio',
      command: 'other_mcp',
      args: [],
    } as StdioOptions);
    expect(genericTransport.stderr).toBeNull();
  });

  it('defaults configured PaddleOCR aliases to piped stderr', async () => {
    const previousServerName = process.env.STEEL_PADDLEOCR_MCP_SERVER_NAME;
    process.env.STEEL_PADDLEOCR_MCP_SERVER_NAME = '  OCRAlias  ';
    try {
      let constructTransport: (() => Promise<{ stderr: unknown }>) | undefined;
      jest.isolateModules(() => {
        const { MCPConnection: IsolatedMCPConnection } = require('../connection') as typeof import(
          '../connection'
        );
        const connection = new IsolatedMCPConnection({
          serverName: 'OCRAlias',
          serverConfig: {
            type: 'stdio',
            command: 'paddleocr_mcp',
            args: [],
          } as StdioOptions,
        });
        constructTransport = () =>
          (connection as unknown as {
            constructTransport: (options: StdioOptions) => Promise<{ stderr: unknown }>;
          }).constructTransport({
            type: 'stdio',
            command: 'paddleocr_mcp',
            args: [],
          });
      });

      if (!constructTransport) {
        throw new Error('Expected isolated MCP transport constructor');
      }
      const transport = await constructTransport();
      expect(transport.stderr).not.toBeNull();
    } finally {
      if (previousServerName === undefined) {
        delete process.env.STEEL_PADDLEOCR_MCP_SERVER_NAME;
      } else {
        process.env.STEEL_PADDLEOCR_MCP_SERVER_NAME = previousServerName;
      }
      jest.resetModules();
    }
  });
});
