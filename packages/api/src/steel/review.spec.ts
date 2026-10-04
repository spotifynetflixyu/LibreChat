import { createHash } from 'node:crypto';
import { encodeSteelReviewDigest } from 'librechat-data-provider';
import { createSteelReviewService } from './review';

const managedMarkdown = [
  '## ocr_result',
  '',
  '| 來源 | 零件編號 |',
  '| --- | --- |',
  '| A | P-1 |',
].join('\n');

const associationMarkdownFor = (
  source: string | null = 'A',
  page: string | null = '1',
  profile = 'P-1',
) => [
  '## ocr_result',
  '',
  '| 來源 | 原始檔案 | 原檔頁碼 | Profile |',
  '| --- | --- | --- | --- |',
  `| ${source ?? ''} | ${source ?? ''} | ${page ?? ''} | ${profile} |`,
].join('\n');

const associationRowsFor = (
  source: string | null = 'A',
  page: string | null = '1',
  profile = 'P-1',
) => [{
  rowId: 'row-1',
  values: {
    來源: { baseline: source, effective: source },
    原始檔案: { baseline: source, effective: source },
    原檔頁碼: { baseline: page, effective: page },
    Profile: { baseline: 'P-1', effective: profile },
  },
  source: source
    ? { fileId: 'file-1', pageNumber: 1, filename: 'drawing.pdf' }
    : null,
}];

describe('Steel review read service', () => {
  it('projects the requested table from the authenticated message identity', async () => {
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result',
          messageId: 'message-1',
          tableId: 'ocr_result:2',
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current',
          markdown: managedMarkdown,
          messageText: [
            '| ordinary | table |',
            '| --- | --- |',
            '| ignored | row |',
            '',
            managedMarkdown,
          ].join('\n'),
        }),
      },
    });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:2',
    })).resolves.toEqual({
      table: expect.objectContaining({
        tableId: 'ocr_result:2',
        outputId: 'ocr_result:generation-1',
        isLatest: true,
        readOnly: false,
        rows: [expect.objectContaining({ rowId: expect.any(String) })],
      }),
    });
  });

  it('rejects a same-heading table that is absent from the trusted canonical output', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: managedMarkdown,
        messageText: [
          '## ocr_result',
          '',
          '| 來源 | 零件編號 |',
          '| --- | --- |',
          '| attacker | fake |',
        ].join('\n'),
      }),
    };
    const service = createSteelReviewService({ reader });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('rejects both identical canonical table copies as ambiguous', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: managedMarkdown,
        messageText: `${managedMarkdown}\n\n${managedMarkdown}`,
      }),
    };
    const service = createSteelReviewService({ reader });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({
      code: 'REVIEW_NOT_FOUND',
      statusCode: 404,
    });
  });

  it('does not carry managed authority across another heading level', async () => {
    const unrelated = [
      '### ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| attacker | P-2 |',
    ].join('\n');
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:2',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: managedMarkdown,
        messageText: `${managedMarkdown}\n\n${unrelated}`,
      }),
    };
    const service = createSteelReviewService({ reader });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:2',
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });
  });

  it('requires a sidecar to match one actual managed table in the owned message', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'review-output-1',
        revision: 'review-revision-1',
        state: 'current' as const,
        headers: ['來源', '零件編號'],
        rows: [{
          rowId: 'row-1',
          values: {
            來源: { baseline: 'A', effective: 'A' },
            零件編號: { baseline: 'P-1', effective: 'P-1' },
          },
          source: null,
        }],
        messageText: [
          '## ocr_result',
          '',
          '| 來源 | 零件編號 |',
          '| --- | --- |',
          '| A | OTHER |',
        ].join('\n'),
      }),
    };
    const service = createSteelReviewService({ reader });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });

    reader.readSteelReview.mockResolvedValueOnce({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'review-output-1',
      revision: 'review-revision-1',
      state: 'current' as const,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
      messageText: `${managedMarkdown}\n\n${managedMarkdown}`,
    });
    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });

    reader.readSteelReview.mockResolvedValueOnce({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'review-output-1',
      revision: 'review-revision-1',
      state: 'current' as const,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
      messageText: `\`\`\`markdown\n${managedMarkdown}\n\`\`\``,
    });
    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });

    reader.readSteelReview.mockResolvedValueOnce({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'review-output-1',
      revision: 'review-revision-1',
      state: 'current' as const,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
      messageText: managedMarkdown,
    });
    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).resolves.toEqual({ table: expect.objectContaining({ outputId: 'review-output-1' }) });
  });

  it('keeps a trusted managed table readable when it has no rows', async () => {
    const emptyMarkdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
    ].join('\n');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result' as const,
          messageId: 'message-1',
          tableId: 'ocr_result:1',
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current' as const,
          markdown: emptyMarkdown,
          messageText: emptyMarkdown,
        }),
      },
    });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    })).resolves.toEqual({ table: expect.objectContaining({ rows: [], readOnly: false }) });
  });

  it('uses the authenticated content part when multiple rendered parts share a message', async () => {
    const firstPart = '| ordinary | table |\n| --- | --- |\n| keep | this |';
    const secondPart = managedMarkdown;
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result' as const,
          messageId: 'message-1',
          tableId: 'ocr_result:2',
          partIndex: 1,
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current' as const,
          markdown: managedMarkdown,
          messageText: secondPart,
          messageTextParts: [{ partIndex: 0, text: firstPart }, { partIndex: 1, text: secondPart }],
          messageTextPartIndex: 1,
        }),
      },
    });

    await expect(service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:2',
      partIndex: 1,
    })).resolves.toEqual({
      table: expect.objectContaining({ tableId: 'ocr_result:2', partIndex: 1 }),
    });
  });

  it('rebuilds commit targets from the trusted reader instead of accepting a client rehash', async () => {
    const markdown = [
      'prefix',
      '',
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-9 |',
      '',
      'suffix',
    ].join('\n');
    const rows = [{
      rowId: 'row-1',
      values: {
        來源: { baseline: 'A', effective: 'A' },
        零件編號: { baseline: 'P-1', effective: 'P-9' },
      },
      source: null,
    }];
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown,
        messageText: markdown,
        headers: ['來源', '零件編號'],
        rows,
      }),
    };
    const commitSteelReview = jest.fn();
    const service = createSteelReviewService({ reader, writer: { commitSteelReview } });
    const prepared = await service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      rows,
    });
    expect(prepared.effectiveMarkdown).toContain('## ocr_result');
    expect(prepared.effectiveMarkdown).not.toContain('prefix');

    await expect(service.commit({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: prepared.outputId,
      revision: prepared.revision,
      rows: prepared.rows,
      operationId: prepared.operationId,
      digest: 'a'.repeat(64),
      headers: prepared.headers,
      messageSha256: prepared.messageSha256,
      target: { start: 0, end: markdown.length, sha256: 'b'.repeat(64) },
      targetText: markdown,
      replacementText: prepared.replacementText,
      cleanReplacementText: prepared.cleanReplacementText,
      effectiveMarkdown: `CORRUPTED\n${prepared.effectiveMarkdown}`,
      displayMarkdown: `CORRUPTED\n${prepared.displayMarkdown}`,
      aiBaselineMarkdown: prepared.aiBaselineMarkdown,
      aiRawMarkdown: prepared.aiRawMarkdown,
      sourceMappings: prepared.sourceMappings,
      caption: prepared.caption,
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('reconciles a physical OCR table after unrelated canonical tables shift its index', async () => {
    const markdown = [
      '```markdown',
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| fake | fenced |',
      '```',
      '',
      '## customer_data',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| keep | customer |',
      '',
      '## ocr_result',
      '',
      'OCR notes remain inside the managed section.',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-1 |',
      '',
      '## extra',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| keep | extra |',
    ].join('\n');
    const record = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:2',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current' as const,
      markdown,
      messageText: markdown,
    };
    const reader = { readSteelReview: jest.fn().mockResolvedValue(record) };
    const service = createSteelReviewService({ reader });
    const current = await service.read({
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
    });
    const rows = current.table.rows.map((row) => ({
      ...row,
      values: {
        ...row.values,
        零件編號: { ...row.values.零件編號, effective: 'P-9' },
      },
    }));

    const prepared = await service.prepare({
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
      outputId: record.outputId,
      revision: record.revision,
      rows,
    });

    expect(prepared.effectiveMarkdown).toContain('## ocr_result');
    expect(prepared.effectiveMarkdown).toContain('OCR notes remain inside the managed section.');
    expect(prepared.effectiveMarkdown).toContain('| A | P-9 |');
    expect(prepared.effectiveMarkdown).not.toContain('customer_data');
    expect(prepared.effectiveMarkdown).not.toContain('## extra');
    expect(prepared.effectiveMarkdown).not.toContain('fenced');
    expect(prepared.target.start).toBeGreaterThan(markdown.indexOf('## ocr_result'));
  });

  it('rejects ambiguous canonical managed table identities before preparing a save', async () => {
    const duplicate = [
      managedMarkdown,
      '',
      managedMarkdown,
    ].join('\n');
    const record = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current' as const,
      markdown: duplicate,
      messageText: duplicate,
    };
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
    });
    await expect(service.prepare({
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
      outputId: record.outputId,
      revision: record.revision,
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-9' },
        },
        source: null,
      }],
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });
  });

  it('uses persisted effective sidecar values rather than the immutable AI baseline', async () => {
    const aiMarkdown = managedMarkdown.replace('P-1', 'P-2');
    const effectiveMarkdown = managedMarkdown.replace('P-1', 'P-7');
    const record = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current' as const,
      markdown: aiMarkdown,
      messageText: effectiveMarkdown,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-2', effective: 'P-7' },
        },
        source: null,
      }],
      effectiveMarkdown,
    };
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
    });
    await expect(service.prepare({
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
      outputId: record.outputId,
      revision: record.revision,
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-2', effective: 'P-8' },
        },
        source: null,
      }],
    })).resolves.toEqual(expect.objectContaining({
      effectiveMarkdown: expect.stringContaining('| A | P-8 |'),
    }));

    record.messageText = aiMarkdown;
    await expect(service.prepare({
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
      outputId: record.outputId,
      revision: record.revision,
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-2', effective: 'P-8' },
        },
        source: null,
      }],
    })).rejects.toMatchObject({ code: 'REVIEW_NOT_FOUND', statusCode: 404 });
  });

  it('rejects source association cell edits while allowing Profile business edits', async () => {
    const trustedRows = associationRowsFor();
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: associationMarkdownFor(),
        messageText: associationMarkdownFor(),
        headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
        rows: trustedRows,
      }),
    };
    const commitSteelReview = jest.fn();
    const service = createSteelReviewService({ reader, writer: { commitSteelReview } });
    const base = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
    };
    const businessRows = associationRowsFor('A', '1', 'P-2');
    const prepared = await service.prepare({ ...base, rows: businessRows });
    expect(prepared.caption.changedRows).toBe(1);

    const forgedSourceRows = associationRowsFor('FORGED-SOURCE', '1', 'P-2');
    await expect(service.prepare({ ...base, rows: forgedSourceRows })).rejects.toMatchObject({
      code: 'INVALID_REVIEW_QUERY',
    });
    const forgedPageRows = associationRowsFor('A', '2', 'P-2');
    await expect(service.commit({
      userId: base.userId,
      ...prepared,
      rows: forgedPageRows,
    })).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('rejects source metadata disappearing while association cells stay unchanged', async () => {
    const trustedRows = associationRowsFor();
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: associationMarkdownFor(),
        messageText: associationMarkdownFor(),
        headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
        rows: trustedRows,
      }),
    };
    const commitSteelReview = jest.fn();
    const service = createSteelReviewService({ reader, writer: { commitSteelReview } });
    const base = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
    };
    const businessRows = associationRowsFor('A', '1', 'P-2');
    const sourceNullRows = associationRowsFor('A', '1', 'P-2');
    sourceNullRows[0]!.source = null;

    await expect(service.prepare({ ...base, rows: sourceNullRows })).rejects.toMatchObject({
      code: 'INVALID_REVIEW_QUERY',
      statusCode: 400,
    });

    const prepared = await service.prepare({ ...base, rows: businessRows });
    const { digest: _digest, ...sourceNullBase } = { ...prepared, rows: sourceNullRows };
    const digest = createHash('sha256').update(encodeSteelReviewDigest({
      ...sourceNullBase,
      userId: 'user-1',
    })).digest('hex');
    await expect(service.commit({ userId: 'user-1', ...sourceNullBase, digest })).rejects.toMatchObject({
      code: 'INVALID_REVIEW_QUERY',
      statusCode: 400,
    });
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('preserves null association cells while preparing a business edit', async () => {
    const rows = associationRowsFor(null, null, 'P-1');
    const markdown = associationMarkdownFor(null, null);
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result' as const,
          messageId: 'message-1',
          tableId: 'ocr_result:1',
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current' as const,
          markdown,
          messageText: markdown,
          headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
          rows,
        }),
      },
    });

    await expect(service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      rows: associationRowsFor(null, null, 'P-2'),
    })).resolves.toEqual(expect.objectContaining({
      caption: { kind: 'ocr_result', changedRows: 1, changedRowIds: ['row-1'] },
    }));
  });

  it('derives a trusted F source mapping and validates a selected PDF page', async () => {
    const rows = associationRowsFor('A', '1', 'P-1');
    const markdown = associationMarkdownFor('A', '1');
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown,
        messageText: markdown,
        headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
        rows,
        sourceMappings: [{
          fileId: 'file-1',
          sourceCode: 'A',
          sourceFilename: 'drawing.pdf',
          mediaType: 'application/pdf',
        }],
      }),
    };
    const readMetadata = jest.fn().mockResolvedValue({
      fileId: 'file-2',
      filename: 'replacement.pdf',
      mediaType: 'application/pdf',
    });
    const readPageCount = jest.fn().mockResolvedValue({ pageCount: 3 });
    const service = createSteelReviewService({
      reader,
      sourceAuthority: { readMetadata, readPageCount },
    });
    const prepared = await service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      sourceRequest: {} as never,
      sourceIntents: [{ rowId: 'row-1', fileId: 'file-2', pageNumber: 2 }],
      rows: [{ ...rows[0]!, values: {
        ...rows[0]!.values,
        Profile: { baseline: 'P-1', effective: 'P-2' },
      } }],
    });

    expect(readMetadata).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-2' }));
    expect(readPageCount).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'file-2' }), {});
    expect(prepared.sourceMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fileId: 'file-2',
        sourceCode: 'F1',
        sourceFilename: 'replacement.pdf',
        mediaType: 'application/pdf',
      }),
    ]));
    expect(prepared.rows[0]?.source).toEqual({
      fileId: 'file-2',
      pageNumber: 2,
      filename: 'replacement.pdf',
      mediaType: 'application/pdf',
    });
    expect(prepared.rows[0]?.values.來源?.effective).toBe('F1');
    expect(prepared.rows[0]?.values.原檔頁碼?.effective).toBe('2');
    expect(prepared.caption.changedRows).toBe(1);
  });

  it('rejects a selected source page outside the server-owned PDF page count', async () => {
    const rows = associationRowsFor('A', '1', 'P-1');
    const markdown = associationMarkdownFor('A', '1');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result' as const,
          messageId: 'message-1',
          tableId: 'ocr_result:1',
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current' as const,
          markdown,
          messageText: markdown,
          headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
          rows,
        }),
      },
      sourceAuthority: {
        readMetadata: jest.fn().mockResolvedValue({
          fileId: 'file-2',
          filename: 'replacement.pdf',
          mediaType: 'application/pdf',
        }),
        readPageCount: jest.fn().mockResolvedValue({ pageCount: 2 }),
      },
    });

    await expect(service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      sourceRequest: {} as never,
      sourceIntents: [{ rowId: 'row-1', fileId: 'file-2', pageNumber: 3 }],
      rows,
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
  });

  it('rejects a present undefined source intent before reading review state', async () => {
    const readSteelReview = jest.fn();
    const service = createSteelReviewService({ reader: { readSteelReview } });
    await expect(service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      rows: associationRowsFor(),
      sourceIntents: undefined,
    } as never)).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY', statusCode: 400 });
    expect(readSteelReview).not.toHaveBeenCalled();
  });

  it('allocates source suffixes with lossless decimal precision', async () => {
    const rows = associationRowsFor(null, '1', 'P-1');
    const markdown = associationMarkdownFor(null, '1');
    const service = createSteelReviewService({
      reader: {
        readSteelReview: jest.fn().mockResolvedValue({
          userId: 'user-1',
          conversationId: 'conversation-1',
          kind: 'ocr_result' as const,
          messageId: 'message-1',
          tableId: 'ocr_result:1',
          outputId: 'ocr_result:generation-1',
          revision: 'generation-1',
          state: 'current' as const,
          markdown,
          messageText: markdown,
          headers: ['來源', '原始檔案', '原檔頁碼', 'Profile'],
          rows,
          sourceMappings: [{
            fileId: 'file-1',
            sourceCode: 'F9007199254740993',
            sourceFilename: 'drawing.pdf',
          }],
        }),
      },
      sourceAuthority: {
        readMetadata: jest.fn().mockResolvedValue({
          fileId: 'file-2', filename: 'replacement.pdf', mediaType: 'application/pdf',
        }),
        readPageCount: jest.fn().mockResolvedValue({ pageCount: 2 }),
      },
    });
    const prepared = await service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      sourceRequest: {} as never,
      sourceIntents: [{ rowId: 'row-1', fileId: 'file-2', pageNumber: 1 }],
      rows,
    });
    expect(prepared.sourceMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ fileId: 'file-2', sourceCode: 'F9007199254740994' }),
    ]));
  });

  it('canonicalizes effective cells before captioning and serializing a save', async () => {
    const markdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-2 |',
    ].join('\n');
    const record = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current' as const,
      markdown,
      messageText: markdown,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-1',
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-2', effective: 'P-2' },
        },
        source: null,
      }],
    };
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn().mockResolvedValue(record) },
    });
    const base = {
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
      outputId: record.outputId,
      revision: record.revision,
    };

    const noOp = await service.prepare({
      ...base,
      rows: [{
        ...record.rows[0],
        values: {
          ...record.rows[0].values,
          零件編號: { baseline: 'P-2', effective: '  P-2\r\n  ' },
        },
      }],
    });
    expect(noOp.caption).toEqual({ kind: 'ocr_result', changedRows: 0, changedRowIds: [] });
    expect(noOp.rows[0]?.values.零件編號.effective).toBe('P-2');
    expect(noOp.cleanReplacementText).toContain('| A | P-2 |');

    const changed = await service.prepare({
      ...base,
      rows: [{
        ...record.rows[0],
        values: {
          ...record.rows[0].values,
          零件編號: { baseline: 'P-2', effective: '  P-7\r\n  ' },
        },
      }],
    });
    expect(changed.caption).toEqual({ kind: 'ocr_result', changedRows: 1, changedRowIds: ['row-1'] });
    expect(changed.rows[0]?.values.零件編號.effective).toBe('P-7');

    const escaped = await service.prepare({
      ...base,
      rows: [{
        ...record.rows[0],
        values: {
          ...record.rows[0].values,
          零件編號: { baseline: 'P-2', effective: ' C:\\path|slot ' },
        },
      }],
    });
    expect(escaped.cleanReplacementText).toContain('C:\\\\path\\|slot');
  });

  it('reconstructs a trusted manual end insertion and rejects forged ledger rows', async () => {
    const markdown = [
      '## ocr_result',
      '',
      '| 來源 | 零件編號 |',
      '| --- | --- |',
      '| A | P-1 |',
    ].join('\n');
    const record = {
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result' as const,
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      revision: 'generation-1',
      state: 'current' as const,
      markdown,
      messageText: markdown,
      headers: ['來源', '零件編號'],
      rows: [{
        rowId: 'row-ai',
        origin: 'ai' as const,
        deleted: false,
        values: {
          來源: { baseline: 'A', effective: 'A' },
          零件編號: { baseline: 'P-1', effective: 'P-1' },
        },
        source: null,
      }],
    };
    const service = createSteelReviewService({ reader: { readSteelReview: jest.fn().mockResolvedValue(record) } });
    const manual = {
      rowId: 'row-manual',
      origin: 'manual' as const,
      deleted: false,
      insertion: { kind: 'end' as const, ordinal: 0 },
      values: {
        來源: { baseline: null, effective: '' },
        零件編號: { baseline: null, effective: 'P-1' },
      },
      source: null,
    };
    const prepared = await service.prepare({
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
      outputId: record.outputId,
      revision: record.revision,
      rows: [record.rows[0]!, manual],
    });
    expect(prepared.rows.map((row) => row.rowId)).toEqual(['row-ai', 'row-manual']);
    expect(prepared.rows[1]).toEqual(expect.objectContaining({ origin: 'manual', deleted: false }));
    expect(prepared.cleanReplacementText).toContain('|  | P-1 |');
    await expect(service.prepare({
      userId: record.userId,
      conversationId: record.conversationId,
      kind: record.kind,
      messageId: record.messageId,
      tableId: record.tableId,
      outputId: record.outputId,
      revision: record.revision,
      rows: [record.rows[0]!, { ...manual, rowId: 'row-ai' }],
    })).rejects.toMatchObject({ code: 'REVIEW_INVALID_OPERATION' });
  });

  it('rejects an uncommitted legacy-shaped commit without a receipt', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: managedMarkdown,
        messageText: managedMarkdown,
      }),
    };
    const resolveSteelReviewReceipt = jest.fn().mockResolvedValue(null);
    const commitSteelReview = jest.fn();
    const service = createSteelReviewService({
      reader,
      writer: { resolveSteelReviewReceipt, commitSteelReview },
    });
    const current = await service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    });
    const trustedPrepared = await service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: current.table.outputId,
      revision: current.table.revision,
      rows: current.table.rows,
    });
    const legacy = { ...trustedPrepared } as Record<string, unknown>;
    delete legacy.sourceMappings;
    await expect(service.commit(legacy as never)).rejects.toMatchObject({
      code: 'REVIEW_INVALID_OPERATION',
    });
    expect(resolveSteelReviewReceipt).toHaveBeenCalledTimes(1);
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('replays an authenticated committed legacy receipt without rebuilding or writing', async () => {
    const reader = {
      readSteelReview: jest.fn().mockResolvedValue({
        userId: 'user-1',
        conversationId: 'conversation-1',
        kind: 'ocr_result' as const,
        messageId: 'message-1',
        tableId: 'ocr_result:1',
        outputId: 'ocr_result:generation-1',
        revision: 'generation-1',
        state: 'current' as const,
        markdown: managedMarkdown,
        messageText: managedMarkdown,
      }),
    };
    const commitSteelReview = jest.fn();
    const savedAt = new Date('2026-10-03T01:00:00.000Z');
    const legacyReceipt: Record<string, unknown> = {};
    const resolveSteelReviewReceipt = jest.fn().mockImplementation(async (candidate) => {
      if (!legacyReceipt || candidate.digest !== legacyReceipt.digest) {
        return null;
      }
      return {
        operationId: candidate.operationId,
        digest: candidate.digest,
        outputId: candidate.outputId,
        revision: 'saved-revision',
        changedRows: 1,
        changedRowIds: ['row-1'],
        savedAt,
        messageSha256: candidate.messageSha256,
        effectiveMarkdown: candidate.effectiveMarkdown,
        displayMarkdown: candidate.displayMarkdown,
      };
    });
    const service = createSteelReviewService({
      reader,
      writer: { resolveSteelReviewReceipt, commitSteelReview },
    });
    const current = await service.read({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
    });
    const trustedPrepared = await service.prepare({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: current.table.outputId,
      revision: current.table.revision,
      rows: current.table.rows,
    });
    const { sourceMappings: _sourceMappings, digest: _digest, ...legacyBase } = trustedPrepared;
    const legacyDigest = createHash('sha256').update(encodeSteelReviewDigest({ ...legacyBase, userId: 'user-1' })).digest('hex');
    Object.assign(legacyReceipt, { ...legacyBase, digest: legacyDigest });
    const readerCallsBeforeCommit = reader.readSteelReview.mock.calls.length;

    const result = await service.commit({
      userId: 'user-1',
      ...legacyReceipt,
      digest: legacyDigest,
    } as never);

    expect(resolveSteelReviewReceipt).toHaveBeenCalledTimes(1);
    expect(reader.readSteelReview).toHaveBeenCalledTimes(readerCallsBeforeCommit);
    expect(commitSteelReview).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      revision: 'saved-revision',
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt: savedAt.toISOString(),
    }));
    expect(Object.prototype.hasOwnProperty.call(result, 'sourceMappings')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(result, 'sourceIntents')).toBe(false);

    await expect(service.commit({
      userId: 'user-1',
      ...legacyReceipt,
      digest: legacyDigest,
      sourceMappings: undefined,
    } as never)).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
    await expect(service.commit({
      userId: 'user-1',
      ...legacyReceipt,
      digest: legacyDigest,
      sourceIntents: undefined,
    } as never)).rejects.toMatchObject({ code: 'INVALID_REVIEW_QUERY' });
    expect(resolveSteelReviewReceipt).toHaveBeenCalledTimes(1);
    expect(commitSteelReview).not.toHaveBeenCalled();
  });

  it('exposes immutable receipt resolution without a write', async () => {
    const savedAt = new Date('2026-10-03T00:00:00.000Z');
    const readSteelReviewReceipt = jest.fn().mockResolvedValue({
      operationId: 'op-1',
      digest: 'a'.repeat(64),
      outputId: 'ocr_result:generation-1',
      revision: 'saved-revision',
      changedRows: 1,
      changedRowIds: ['row-1'],
      savedAt,
      messageSha256: 'b'.repeat(64),
      effectiveMarkdown: '## ocr_result\n\n| A | B |',
      displayMarkdown: '## ocr_result\n\n| A | B |',
      snapshot: {
        operationId: 'op-1',
        digest: 'a'.repeat(64),
        outputId: 'ocr_result:generation-1',
        revision: 'saved-revision',
        headers: ['來源'],
        rows: [],
        changedRows: 1,
        changedRowIds: ['row-1'],
        savedAt,
        conversationId: 'conversation-1',
        messageId: 'message-1',
        messageText: '## ocr_result\n\n| A | B |',
        messageSha256: 'b'.repeat(64),
        effectiveMarkdown: '## ocr_result\n\n| A | B |',
        displayMarkdown: '## ocr_result\n\n| A | B |',
      },
    });
    const service = createSteelReviewService({
      reader: { readSteelReview: jest.fn() },
      writer: { commitSteelReview: jest.fn(), readSteelReviewReceipt },
    });

    await expect(service.receipt({
      userId: 'user-1',
      conversationId: 'conversation-1',
      kind: 'ocr_result',
      messageId: 'message-1',
      tableId: 'ocr_result:1',
      outputId: 'ocr_result:generation-1',
      operationId: 'op-1',
      digest: 'a'.repeat(64),
    })).resolves.toMatchObject({
      status: 'committed',
      snapshot: { revision: 'saved-revision', savedAt: savedAt.toISOString() },
    });
    expect(readSteelReviewReceipt).toHaveBeenCalledTimes(1);
  });
});
