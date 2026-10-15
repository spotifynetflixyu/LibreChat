const STDERR_RING_MAX_ENTRIES = 64;
const STDERR_RING_MAX_BYTES = 32 * 1024;
const textDecoder = new TextDecoder();

interface StderrEntry {
  sequence: number;
  text: string;
  bytes: number;
}

function toBytes(chunk: unknown): Uint8Array {
  if (typeof chunk === 'string') return new TextEncoder().encode(chunk);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  return new Uint8Array(0);
}

function boundText(value: string): string {
  if (Buffer.byteLength(value, 'utf8') <= STDERR_RING_MAX_BYTES) {
    return value;
  }
  return Buffer.from(value, 'utf8').subarray(-STDERR_RING_MAX_BYTES).toString('utf8');
}

/**
 * Bounded, line-oriented capture of an MCP stdio server's stderr so a failed
 * PaddleOCR call can be classified from what the server printed during it.
 */
export class StderrRing {
  private readonly entries: StderrEntry[] = [];
  private pending = '';
  private bytes = 0;
  private nextSequence = 0;
  private readonly onData = (chunk: unknown) => {
    const parts = textDecoder.decode(toBytes(chunk)).split(/\r?\n/gu);
    this.pending = boundText(this.pending + (parts.shift() ?? ''));
    if (parts.length === 0) return;
    this.append(this.pending);
    const trailing = parts.pop();
    for (const part of parts) this.append(part);
    this.pending = boundText(trailing ?? '');
  };

  private readonly onEnd = () => this.flush();

  constructor(private readonly stream: Pick<NodeJS.EventEmitter, 'on' | 'removeListener'>) {
    stream.on('data', this.onData);
    stream.on('end', this.onEnd);
    stream.on('close', this.onEnd);
  }

  cursor(): number {
    this.flush();
    return this.nextSequence;
  }

  readSince(cursor: number): string {
    this.flush();
    return this.entries
      .filter((entry) => entry.sequence >= cursor)
      .map((entry) => entry.text)
      .join('\n');
  }

  detach(): void {
    this.stream.removeListener('data', this.onData);
    this.stream.removeListener('end', this.onEnd);
    this.stream.removeListener('close', this.onEnd);
    this.entries.length = 0;
    this.pending = '';
    this.bytes = 0;
  }

  private flush(): void {
    if (this.pending === '') return;
    this.append(this.pending);
    this.pending = '';
  }

  private append(text: string): void {
    if (text === '') return;
    const bounded = boundText(text);
    const bytes = Buffer.byteLength(bounded, 'utf8');
    this.entries.push({ sequence: this.nextSequence++, text: bounded, bytes });
    this.bytes += bytes;
    while (this.entries.length > STDERR_RING_MAX_ENTRIES || this.bytes > STDERR_RING_MAX_BYTES) {
      const removed = this.entries.shift();
      if (!removed) break;
      this.bytes -= removed.bytes;
    }
  }
}
