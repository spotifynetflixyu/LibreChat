import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, Download, Maximize2, X } from 'lucide-react';
import { useLocalize } from '~/hooks';

type TableMatrix = string[][];

type MarkdownTableActionsProps = {
  children: React.ReactNode;
};

type ThemeAttributes = {
  className: string;
  dataTheme?: string;
};

type TableToolbarProps = {
  tableRef: React.RefObject<HTMLTableElement>;
  copied: boolean;
  expanded: boolean;
  onClose?: () => void;
  onCopied: () => void;
  onExpand?: () => void;
};

type ZipFile = {
  path: string;
  data: Uint8Array;
};

type ZipEntry = ZipFile & {
  crc: number;
  offset: number;
  pathBytes: Uint8Array;
};

const xlsxMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function encodeText(value: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }

  const bytes: number[] = [];
  for (const char of Array.from(value)) {
    const codePoint = char.codePointAt(0) ?? 0;

    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return new Uint8Array(bytes);
}

function readThemeAttributes(): ThemeAttributes {
  if (typeof document === 'undefined') {
    return { className: '' };
  }

  const root = document.documentElement;
  const themeClasses = ['dark', 'light'].filter((className) => root.classList.contains(className));
  const dataTheme = root.getAttribute('data-theme') ?? undefined;

  return {
    className: themeClasses.join(' '),
    dataTheme,
  };
}

function useThemeAttributes(enabled: boolean): ThemeAttributes {
  const [themeAttributes, setThemeAttributes] = useState(readThemeAttributes);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const updateThemeAttributes = () => setThemeAttributes(readThemeAttributes());

    if (typeof MutationObserver === 'undefined') {
      updateThemeAttributes();
      return undefined;
    }

    const observer = new MutationObserver(updateThemeAttributes);

    observer.observe(document.documentElement, {
      attributeFilter: ['class', 'data-theme'],
      attributes: true,
    });

    updateThemeAttributes();
    return () => observer.disconnect();
  }, [enabled]);

  return themeAttributes;
}

function normalizeCellText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function getTableMatrix(table: HTMLTableElement | null): TableMatrix {
  if (!table) {
    return [];
  }

  return Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => normalizeCellText(cell.innerText || cell.textContent || '')),
  );
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function tableMatrixToMarkdown(matrix: TableMatrix): string {
  const [header, ...rows] = matrix;
  if (!header || header.length === 0) {
    return '';
  }

  const divider = header.map(() => '---');
  return [header, divider, ...rows]
    .map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`)
    .join('\n');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let remaining = index + 1;
  let name = '';

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    name = String.fromCharCode(65 + modulo) + name;
    remaining = Math.floor((remaining - modulo - 1) / 26);
  }

  return name;
}

function matrixToWorksheetXml(matrix: TableMatrix): string {
  const rows = matrix
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, cellIndex) => {
          const ref = `${columnName(cellIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
        })
        .join('');

      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rows}</sheetData>
</worksheet>`;
}

function createCrc32Table(): Uint32Array {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }

  return table;
}

const crc32Table = createCrc32Table();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of data) {
    crc = crc32Table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function writeUint16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function writeUint32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function createZip(files: readonly ZipFile[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const file of files) {
    const pathBytes = encodeText(file.path);
    const crc = crc32(file.data);
    const header = new Uint8Array(30 + pathBytes.length);
    const view = new DataView(header.buffer);

    writeUint32(view, 0, 0x04034b50);
    writeUint16(view, 4, 20);
    writeUint16(view, 6, 0);
    writeUint16(view, 8, 0);
    writeUint16(view, 10, 0);
    writeUint16(view, 12, 0);
    writeUint32(view, 14, crc);
    writeUint32(view, 18, file.data.length);
    writeUint32(view, 22, file.data.length);
    writeUint16(view, 26, pathBytes.length);
    writeUint16(view, 28, 0);
    header.set(pathBytes, 30);

    entries.push({ ...file, crc, offset, pathBytes });
    localParts.push(header, file.data);
    offset += header.length + file.data.length;
  }

  const centralDirectoryOffset = offset;
  const centralParts = entries.map((entry) => {
    const header = new Uint8Array(46 + entry.pathBytes.length);
    const view = new DataView(header.buffer);

    writeUint32(view, 0, 0x02014b50);
    writeUint16(view, 4, 20);
    writeUint16(view, 6, 20);
    writeUint16(view, 8, 0);
    writeUint16(view, 10, 0);
    writeUint16(view, 12, 0);
    writeUint16(view, 14, 0);
    writeUint32(view, 16, entry.crc);
    writeUint32(view, 20, entry.data.length);
    writeUint32(view, 24, entry.data.length);
    writeUint16(view, 28, entry.pathBytes.length);
    writeUint16(view, 30, 0);
    writeUint16(view, 32, 0);
    writeUint16(view, 34, 0);
    writeUint16(view, 36, 0);
    writeUint32(view, 38, 0);
    writeUint32(view, 42, entry.offset);
    header.set(entry.pathBytes, 46);

    return header;
  });
  const centralDirectorySize = centralParts.reduce((total, part) => total + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);

  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralDirectorySize);
  writeUint32(endView, 16, centralDirectoryOffset);
  writeUint16(endView, 20, 0);

  return concatBytes([...localParts, ...centralParts, end]);
}

function createXlsxBlob(matrix: TableMatrix): Blob {
  const files = [
    {
      path: '[Content_Types].xml',
      data: encodeText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    },
    {
      path: '_rels/.rels',
      data: encodeText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`),
    },
    {
      path: 'docProps/app.xml',
      data: encodeText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>LibreChat</Application>
</Properties>`),
    },
    {
      path: 'docProps/core.xml',
      data: encodeText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:creator>LibreChat</dc:creator>
</cp:coreProperties>`),
    },
    {
      path: 'xl/workbook.xml',
      data: encodeText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Table" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
    },
    {
      path: 'xl/_rels/workbook.xml.rels',
      data: encodeText(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    },
    {
      path: 'xl/worksheets/sheet1.xml',
      data: encodeText(matrixToWorksheetXml(matrix)),
    },
  ];

  return new Blob([toArrayBuffer(createZip(files))], { type: xlsxMimeType });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function TableActionButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="markdown-table-action"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TableToolbar({
  tableRef,
  copied,
  expanded,
  onClose,
  onCopied,
  onExpand,
}: TableToolbarProps) {
  const localize = useLocalize();
  const copyLabel = localize('com_ui_copy_markdown_table');
  const downloadLabel = localize('com_ui_download_table_xlsx');
  const expandLabel = localize('com_ui_expand_table');
  const closeLabel = localize('com_ui_close_table');
  const handleCopy = useCallback(() => {
    void writeClipboardText(tableMatrixToMarkdown(getTableMatrix(tableRef.current))).then(onCopied);
  }, [onCopied, tableRef]);
  const handleDownload = useCallback(() => {
    downloadBlob(createXlsxBlob(getTableMatrix(tableRef.current)), 'markdown-table.xlsx');
  }, [tableRef]);

  return (
    <div className="markdown-table-toolbar">
      <TableActionButton label={copyLabel} onClick={handleCopy}>
        {copied ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </TableActionButton>
      <TableActionButton label={downloadLabel} onClick={handleDownload}>
        <Download className="size-4" aria-hidden="true" />
      </TableActionButton>
      {expanded ? (
        <TableActionButton label={closeLabel} onClick={onClose ?? (() => undefined)}>
          <X className="size-4" aria-hidden="true" />
        </TableActionButton>
      ) : (
        <TableActionButton label={expandLabel} onClick={onExpand ?? (() => undefined)}>
          <Maximize2 className="size-4" aria-hidden="true" />
        </TableActionButton>
      )}
    </div>
  );
}

const MarkdownTableActions = memo(function MarkdownTableActions({
  children,
}: MarkdownTableActionsProps) {
  const tableRef = useRef<HTMLTableElement>(null);
  const modalTableRef = useRef<HTMLTableElement>(null);
  const copiedResetTimerRef = useRef<number>();
  const modalCopiedResetTimerRef = useRef<number>();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [modalCopied, setModalCopied] = useState(false);
  const localize = useLocalize();
  const themeAttributes = useThemeAttributes(isExpanded);
  const modalClassName = ['markdown-table-modal', themeAttributes.className].filter(Boolean).join(' ');
  const handleCopied = useCallback(() => {
    if (copiedResetTimerRef.current) {
      window.clearTimeout(copiedResetTimerRef.current);
    }
    setCopied(true);
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedResetTimerRef.current = undefined;
    }, 1200);
  }, []);
  const handleModalCopied = useCallback(() => {
    if (modalCopiedResetTimerRef.current) {
      window.clearTimeout(modalCopiedResetTimerRef.current);
    }
    setModalCopied(true);
    modalCopiedResetTimerRef.current = window.setTimeout(() => {
      setModalCopied(false);
      modalCopiedResetTimerRef.current = undefined;
    }, 1200);
  }, []);
  const closeModal = useCallback(() => setIsExpanded(false), []);

  useEffect(
    () => () => {
      if (copiedResetTimerRef.current) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
      if (modalCopiedResetTimerRef.current) {
        window.clearTimeout(modalCopiedResetTimerRef.current);
      }
    },
    [],
  );

  return (
    <div className="markdown-table-container">
      <TableToolbar
        tableRef={tableRef}
        copied={copied}
        expanded={false}
        onCopied={handleCopied}
        onExpand={() => setIsExpanded(true)}
      />
      <div className="markdown-table-wrapper w-full max-w-full">
        <table ref={tableRef}>{children}</table>
      </div>
      {isExpanded &&
        createPortal(
          <div
            className={modalClassName}
            data-theme={themeAttributes.dataTheme}
            role="dialog"
            aria-modal="true"
            aria-label={localize('com_ui_expand_table')}
          >
            <div className="markdown-table-modal-surface markdown">
              <TableToolbar
                tableRef={modalTableRef}
                copied={modalCopied}
                expanded={true}
                onClose={closeModal}
                onCopied={handleModalCopied}
              />
              <div className="markdown-table-modal-scroll">
                <table ref={modalTableRef}>{children}</table>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
});

export default MarkdownTableActions;
