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
