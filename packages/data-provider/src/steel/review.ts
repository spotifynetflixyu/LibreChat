import { z } from 'zod';

export const steelReviewKinds = ['ocr_result', 'system_order'] as const;
export type SteelReviewKind = (typeof steelReviewKinds)[number];

const steelReviewSourceAssociationHeaders = new Set([
  '來源',
  '頁碼',
  '檔案',
  '來源檔案',
  '檔名',
  '來源檔名',
  '圖片',
  '原始檔案',
  '原檔頁碼',
  '原始頁碼',
  '原始檔名',
  'source',
  'file',
  'filename',
  'page',
  'page number',
  'source file',
  'source filename',
  'source page',
  'image',
  'original file',
  'original filename',
  'original page',
  'original page number',
].map((header) => header.toLowerCase().replace(/[\s_]+/g, '')));

export function isSteelReviewSourceAssociationHeader(header: string): boolean {
  return steelReviewSourceAssociationHeaders.has(header.trim().toLowerCase().replace(/[\s_]+/g, ''));
}

export const steelReviewErrorCodeSchema = z.enum([
  'INVALID_REVIEW_QUERY',
  'REVIEW_NOT_FOUND',
  'REVIEW_CONFLICT',
  'REVIEW_INVALID_OPERATION',
]);
export type SteelReviewErrorCode = z.infer<typeof steelReviewErrorCodeSchema>;

export const steelReviewOwnerUpdatedSchema = z.object({
  version: z.literal(1),
  kind: z.enum(steelReviewKinds),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  tableId: z.string().min(1),
  outputId: z.string().min(1),
  revision: z.string().min(1),
  updatedAt: z.string().datetime(),
});
export type SteelReviewOwnerUpdated = z.infer<typeof steelReviewOwnerUpdatedSchema>;

export const steelReviewRequoteProvenanceSchema = z.object({
  sourceKind: z.literal('ocr_result'),
  sourceMessageId: z.string().min(1),
  sourceTableId: z.string().min(1),
  sourceOutputId: z.string().min(1),
  sourceRevision: z.string().min(1),
  changedRows: z.number().int().positive(),
  at: z.string().datetime(),
});
export type SteelReviewRequoteProvenance = z.infer<typeof steelReviewRequoteProvenanceSchema>;

export function getSteelReviewTableId(kind: SteelReviewKind, markdownIndex: number): string {
  return `${kind}:${markdownIndex}`;
}

export const steelReviewReadQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  tableId: z.string().trim().min(1).max(300),
  partIndex: z.coerce.number().int().nonnegative().max(10_000).optional(),
});
export type SteelReviewReadQuery = z.infer<typeof steelReviewReadQuerySchema>;

export const steelReviewReceiptQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  tableId: z.string().trim().min(1).max(300),
  outputId: z.string().trim().min(1).max(300),
  operationId: z.string().trim().min(1).max(300),
  digest: z.string().length(64),
});
export type SteelReviewReceiptQuery = z.infer<typeof steelReviewReceiptQuerySchema>;

export const steelReviewSourceSchema = z.object({
  fileId: z.string().min(1),
  pageNumber: z.number().int().positive().nullable(),
  filename: z.string().min(1).optional(),
  mediaType: z.string().min(1).optional(),
});

export const steelReviewSourceIntentSchema = z.object({
  rowId: z.string().min(1),
  fileId: z.string().min(1).nullable(),
  pageNumber: z.number().int().positive().nullable(),
}).superRefine((intent, context) => {
  if (intent.fileId === null && intent.pageNumber !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'A cleared source cannot keep a page' });
  }
});

export const steelReviewSourceMappingSchema = z.object({
  fileId: z.string().min(1),
  sourceCode: z.string().min(1),
  sourceFilename: z.string().min(1),
  mediaType: z.string().min(1).optional(),
});

export const steelReviewCellSchema = z.object({
  baseline: z.string().nullable(),
  effective: z.string().nullable(),
});

export const steelReviewRowOriginSchema = z.enum(['ai', 'manual']);

export const steelReviewRowInsertionSchema = z.object({
  kind: z.enum(['start', 'end', 'after']),
  rowId: z.string().min(1).optional(),
  ordinal: z.number().int().nonnegative(),
}).superRefine((insertion, context) => {
  if (insertion.kind === 'after' && !insertion.rowId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rowId'], message: 'An after anchor requires a row id' });
  }
  if (insertion.kind !== 'after' && insertion.rowId !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['rowId'], message: 'Only an after anchor may include a row id' });
  }
});

export const steelReviewRowSchema = z.object({
  rowId: z.string().min(1),
  values: z.record(z.string(), steelReviewCellSchema),
  source: steelReviewSourceSchema.nullable(),
  // These fields were added by Ticket05. They stay optional at the shared
  // boundary so an authenticated 03/04 receipt can be decoded byte-for-byte.
  origin: steelReviewRowOriginSchema.optional(),
  deleted: z.boolean().optional(),
  insertion: steelReviewRowInsertionSchema.optional(),
});

export const steelReviewTargetSchema = z.object({
  partIndex: z.number().int().nonnegative().optional(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  sha256: z.string().length(64),
});

export const steelReviewCaptionSchema = z.object({
  kind: z.enum(steelReviewKinds),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
});

export const steelReviewTextPartSchema = z.object({
  partIndex: z.number().int().nonnegative(),
  text: z.string(),
});

/**
 * The immutable result captured by one successful human save.  This is kept
 * on the receipt rather than read back from the current sidecar so a retry of
 * an older operation cannot accidentally return a later revision.
 */
export const steelReviewSavedSnapshotSchema = z.object({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  outputId: z.string().min(1),
  revision: z.string().min(1),
  headers: z.array(z.string()),
  rows: z.array(steelReviewRowSchema),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
  savedAt: z.string().datetime(),
  messageSha256: z.string().length(64),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  messageText: z.string(),
  messageTextParts: z.array(steelReviewTextPartSchema).optional(),
  effectiveMarkdown: z.string(),
  displayMarkdown: z.string(),
  sourceMappings: z.array(steelReviewSourceMappingSchema).optional(),
  ownerUpdated: steelReviewOwnerUpdatedSchema.optional(),
});

export const steelReviewReceiptSchema = z.object({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  revision: z.string().min(1),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
  savedAt: z.string().datetime(),
  snapshot: steelReviewSavedSnapshotSchema.optional(),
});

export const steelReviewTableSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  tableId: z.string().min(1),
  partIndex: z.number().int().nonnegative().optional(),
  outputId: z.string().min(1),
  kind: z.enum(steelReviewKinds),
  revision: z.string().min(1),
  latestOutputId: z.string().min(1),
  isLatest: z.boolean(),
  readOnly: z.boolean(),
  humanSavedAt: z.string().datetime().optional(),
  updated: z.boolean().optional(),
  previousVersion: z.boolean().optional(),
  aiUpdatedAt: z.string().datetime().optional(),
  ownerUpdated: steelReviewOwnerUpdatedSchema.optional(),
  needsRequote: z.boolean().optional(),
  requoteProvenance: steelReviewRequoteProvenanceSchema.optional(),
  aiRawMarkdown: z.string().optional(),
  aiBaselineMarkdown: z.string().optional(),
  humanMarkdown: z.string().optional(),
  effectiveMarkdown: z.string().optional(),
  displayMarkdown: z.string().optional(),
  lastSave: steelReviewReceiptSchema.optional(),
  headers: z.array(z.string()),
  rows: z.array(steelReviewRowSchema),
  sourceMappings: z.array(steelReviewSourceMappingSchema).optional(),
});

const steelReviewPrepareBaseSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  tableId: z.string().min(1),
  partIndex: z.number().int().nonnegative().optional(),
  kind: z.enum(steelReviewKinds),
  outputId: z.string().min(1),
  revision: z.string().min(1),
  rows: z.array(steelReviewRowSchema),
  sourceIntents: z.array(steelReviewSourceIntentSchema).optional(),
}).strict();

function rejectPresentInvalidSourceFields(
  value: { sourceIntents?: unknown; sourceMappings?: unknown },
  context: z.RefinementCtx,
): void {
  for (const field of ['sourceIntents', 'sourceMappings'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, field) && !Array.isArray(value[field])) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} must be an array when present`,
      });
    }
  }
}

export const steelReviewPrepareSchema = steelReviewPrepareBaseSchema.superRefine(rejectPresentInvalidSourceFields);

const steelReviewPreparedBaseSchema = steelReviewPrepareBaseSchema.extend({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  messageSha256: z.string().length(64),
  target: steelReviewTargetSchema,
  replacementText: z.string(),
  cleanReplacementText: z.string(),
  targetText: z.string(),
  headers: z.array(z.string()),
  effectiveMarkdown: z.string(),
  displayMarkdown: z.string(),
  aiBaselineMarkdown: z.string().optional(),
  aiRawMarkdown: z.string().optional(),
  sourceMappings: z.array(steelReviewSourceMappingSchema),
  caption: steelReviewCaptionSchema,
});

export const steelReviewPreparedSchema = steelReviewPreparedBaseSchema.superRefine(rejectPresentInvalidSourceFields);

// The old 03 commit shape is retained only so the API can validate an
// already-committed receipt replay without manufacturing a new operation.
export const steelReviewLegacyCommitSchema = steelReviewPreparedBaseSchema.omit({
  sourceIntents: true,
  sourceMappings: true,
});

export const steelReviewCommitSchema = steelReviewPreparedSchema;

export const steelReviewSaveResponseSchema = steelReviewPreparedBaseSchema.extend({
  savedAt: z.string().datetime(),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
  savedSnapshot: steelReviewSavedSnapshotSchema.optional(),
}).superRefine(rejectPresentInvalidSourceFields);

export const steelReviewResponseSchema = z.object({
  table: steelReviewTableSchema.nullable(),
});

export const steelReviewReceiptStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('absent') }),
  z.object({ status: z.literal('committed'), snapshot: steelReviewSavedSnapshotSchema }),
]);

export const steelReviewErrorResponseSchema = z.object({
  code: steelReviewErrorCodeSchema,
  message: z.string(),
});

export const steelReviewSourceFileSchema = z.object({
  fileId: z.string().min(1),
  filename: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative().optional(),
});

export const steelReviewSourcesResponseSchema = z.object({
  sources: z.array(steelReviewSourceFileSchema),
});

export const steelReviewSourcePageCountSchema = z.object({
  pageCount: z.number().int().positive(),
});

export const steelReviewSourceQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  tableId: z.string().trim().min(1).max(300).optional(),
});

export const steelReviewSourceBinaryQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
});

export type SteelReviewSource = z.infer<typeof steelReviewSourceSchema>;
export type SteelReviewSourceIntent = z.infer<typeof steelReviewSourceIntentSchema>;
export type SteelReviewSourceMapping = z.infer<typeof steelReviewSourceMappingSchema>;
export type SteelReviewCell = z.infer<typeof steelReviewCellSchema>;
export type SteelReviewRowOrigin = z.infer<typeof steelReviewRowOriginSchema>;
export type SteelReviewRowInsertion = z.infer<typeof steelReviewRowInsertionSchema>;
export type SteelReviewRow = z.infer<typeof steelReviewRowSchema>;
export type SteelReviewLedgerRow = Omit<SteelReviewRow, 'origin' | 'deleted'> & {
  origin: SteelReviewRowOrigin;
  deleted: boolean;
};
export type SteelReviewTable = z.infer<typeof steelReviewTableSchema>;
export type SteelReviewResponse = z.infer<typeof steelReviewResponseSchema>;
export type SteelReviewReceiptStatus = z.infer<typeof steelReviewReceiptStatusSchema>;
export type SteelReviewErrorResponse = z.infer<typeof steelReviewErrorResponseSchema>;
export type SteelReviewTarget = z.infer<typeof steelReviewTargetSchema>;
export type SteelReviewCaption = z.infer<typeof steelReviewCaptionSchema>;
export type SteelReviewSavedSnapshot = z.infer<typeof steelReviewSavedSnapshotSchema>;
export type SteelReviewReceipt = z.infer<typeof steelReviewReceiptSchema>;
export type SteelReviewPrepare = z.infer<typeof steelReviewPrepareSchema>;
export type SteelReviewPrepared = z.infer<typeof steelReviewPreparedSchema>;
export type SteelReviewCommit = z.infer<typeof steelReviewCommitSchema>;

export type SteelReviewDigestInput = Omit<SteelReviewPrepared, 'operationId' | 'digest' | 'sourceIntents' | 'sourceMappings'> & {
  userId: string;
  tenantId?: string | null;
  sourceIntents?: SteelReviewSourceIntent[];
  sourceMappings?: SteelReviewSourceMapping[];
};

export function sameSteelReviewSource(
  left: SteelReviewSource | null,
  right: SteelReviewSource | null,
): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  return left.fileId === right.fileId &&
    left.pageNumber === right.pageNumber &&
    left.filename === right.filename &&
    left.mediaType === right.mediaType;
}

/** Canonicalize one user-editable cell without changing null or baseline data. */
export function normalizeSteelReviewEffectiveValue(value: string | null): string | null {
  return value === null ? null : value.trim().replace(/[\r\n]+/g, ' ');
}

export function normalizeSteelReviewRows(rows: readonly SteelReviewRow[]): SteelReviewRow[] {
  return rows.map((row) => {
    const values: Record<string, SteelReviewCell> = {};
    for (const [header, cell] of Object.entries(row.values)) {
      values[header] = Object.prototype.hasOwnProperty.call(cell, 'effective')
        ? { ...cell, effective: normalizeSteelReviewEffectiveValue(cell.effective) }
        : { ...cell };
    }
    return { ...row, values };
  });
}

/**
 * Materialize the Ticket05 ledger only after a row has crossed an
 * authenticated trusted-view boundary. This deliberately preserves absent
 * properties for old digest inputs and receipt snapshots.
 */
export function withSteelReviewLedgerDefaults(row: SteelReviewRow): SteelReviewLedgerRow {
  return {
    ...row,
    origin: row.origin ?? 'ai',
    deleted: row.deleted ?? false,
  };
}

export function normalizeSteelReviewLedgerRows(rows: readonly SteelReviewRow[]): SteelReviewLedgerRow[] {
  return normalizeSteelReviewRows(rows).map(withSteelReviewLedgerDefaults);
}

export type SteelReviewLedgerValidationCode =
  | 'duplicate-id'
  | 'existing-authority'
  | 'existing-insertion'
  | 'existing-order'
  | 'new-row-authority'
  | 'insertion-anchor'
  | 'insertion-order';

export type SteelReviewLedgerValidation =
  | {
      ok: true;
      currentRows: SteelReviewLedgerRow[];
      submittedRows: SteelReviewLedgerRow[];
      orderedRows: SteelReviewLedgerRow[];
      orderedSubmittedRows: SteelReviewLedgerRow[];
    }
  | {
      ok: false;
      code: SteelReviewLedgerValidationCode;
      rowId?: string;
    };

function ledgerInsertionKey(insertion: SteelReviewRowInsertion | undefined): string {
  if (!insertion || insertion.kind === 'start') return 'start';
  if (insertion.kind === 'end') return 'end';
  return `after:${insertion.rowId}`;
}

/**
 * Validate and deterministically order a trusted ledger before a boundary
 * applies source authorization or persistence-specific error handling.
 * Defaults are materialized only in this trusted result, never in a digest.
 */
export function validateSteelReviewLedger(
  currentRows: readonly SteelReviewRow[],
  submittedRows: readonly SteelReviewRow[],
  headers: readonly string[],
): SteelReviewLedgerValidation {
  const current = normalizeSteelReviewLedgerRows(currentRows);
  const submitted = normalizeSteelReviewLedgerRows(submittedRows);
  const currentById = new Map(current.map((row) => [row.rowId, row]));
  const seenIds = new Set<string>();
  for (const row of submitted) {
    if (seenIds.has(row.rowId)) {
      return { ok: false, code: 'duplicate-id', rowId: row.rowId };
    }
    seenIds.add(row.rowId);
    const prior = currentById.get(row.rowId);
    if (prior) {
      const sameBaseline = headers.every((header) =>
        (prior.values[header]?.baseline ?? null) === (row.values[header]?.baseline ?? null));
      if (row.origin !== prior.origin || !sameBaseline) {
        return { ok: false, code: 'existing-authority', rowId: row.rowId };
      }
      if (JSON.stringify(row.insertion) !== JSON.stringify(prior.insertion)) {
        return { ok: false, code: 'existing-insertion', rowId: row.rowId };
      }
      continue;
    }
    if (row.origin !== 'manual' || row.deleted || !row.insertion ||
      headers.some((header) => row.values[header]?.baseline !== null)) {
      return { ok: false, code: 'new-row-authority', rowId: row.rowId };
    }
  }

  const existingIds = submitted.filter((row) => currentById.has(row.rowId)).map((row) => row.rowId);
  if (JSON.stringify(existingIds) !== JSON.stringify(current.map((row) => row.rowId))) {
    return { ok: false, code: 'existing-order' };
  }

  const usedOrdinals = new Set<string>();
  for (const row of current) {
    const insertion = row.insertion;
    if (!insertion) continue;
    const key = `${ledgerInsertionKey(insertion)}:${insertion.ordinal}`;
    if (usedOrdinals.has(key)) return { ok: false, code: 'insertion-order', rowId: row.rowId };
    usedOrdinals.add(key);
  }
  const activeIds = new Set(current.filter((row) => !row.deleted).map((row) => row.rowId));
  for (const row of submitted) {
    if (currentById.has(row.rowId)) continue;
    const insertion = row.insertion!;
    if (insertion.kind === 'after' && !activeIds.has(insertion.rowId!)) {
      return { ok: false, code: 'insertion-anchor', rowId: row.rowId };
    }
    const key = `${ledgerInsertionKey(insertion)}:${insertion.ordinal}`;
    if (usedOrdinals.has(key)) return { ok: false, code: 'insertion-order', rowId: row.rowId };
    usedOrdinals.add(key);
  }

  const additionsByAnchor = new Map<string, SteelReviewLedgerRow[]>();
  const submittedById = new Map(submitted.map((row) => [row.rowId, row]));
  for (const row of submitted) {
    if (currentById.has(row.rowId)) continue;
    const key = ledgerInsertionKey(row.insertion);
    const additions = additionsByAnchor.get(key) ?? [];
    additions.push(row);
    additionsByAnchor.set(key, additions);
  }
  const sorted = (rows: readonly SteelReviewLedgerRow[]) =>
    [...rows].sort((left, right) => (left.insertion?.ordinal ?? 0) - (right.insertion?.ordinal ?? 0));
  const orderedRows: SteelReviewLedgerRow[] = [...sorted(additionsByAnchor.get('start') ?? [])];
  for (const row of current) {
    orderedRows.push(row);
    orderedRows.push(...sorted(additionsByAnchor.get(`after:${row.rowId}`) ?? []));
  }
  orderedRows.push(...sorted(additionsByAnchor.get('end') ?? []));
  const orderedSubmittedRows = orderedRows.map((row) => submittedById.get(row.rowId) ?? row);
  return { ok: true, currentRows: current, submittedRows: submitted, orderedRows, orderedSubmittedRows };
}

/** Keep the wire digest's field order and null semantics in one browser-safe encoder. */
export function encodeSteelReviewDigest(input: SteelReviewDigestInput): string {
  const hasSourceIntents = Object.prototype.hasOwnProperty.call(input, 'sourceIntents');
  const hasSourceMappings = Object.prototype.hasOwnProperty.call(input, 'sourceMappings');
  if ((hasSourceIntents && !Array.isArray(input.sourceIntents)) ||
    (hasSourceMappings && !Array.isArray(input.sourceMappings))) {
    throw new Error('Steel review source digest fields must be arrays when present');
  }
  const payload: {
    userId: string;
    tenantId: string | null;
    conversationId: string;
    kind: SteelReviewKind;
    messageId: string;
    tableId: string;
    partIndex: number | null;
    outputId: string;
    revision: string;
    rows: SteelReviewRow[];
    sourceIntents?: SteelReviewSourceIntent[];
    sourceMappings?: SteelReviewSourceMapping[];
    headers?: string[];
    messageSha256?: string;
    target?: SteelReviewTarget;
    targetText?: string;
    replacementText?: string;
    cleanReplacementText?: string;
    effectiveMarkdown?: string;
    displayMarkdown?: string;
    aiBaselineMarkdown?: string | null;
    aiRawMarkdown?: string | null;
    caption?: SteelReviewCaption;
  } = {
    userId: input.userId,
    tenantId: input.tenantId ?? null,
    conversationId: input.conversationId,
    kind: input.kind,
    messageId: input.messageId,
    tableId: input.tableId,
    partIndex: input.partIndex ?? null,
    outputId: input.outputId,
    revision: input.revision,
    rows: input.rows,
  };
  if (hasSourceIntents) {
    payload.sourceIntents = input.sourceIntents;
  }
  if (hasSourceMappings) {
    payload.sourceMappings = input.sourceMappings;
  }
  payload.headers = input.headers;
  payload.messageSha256 = input.messageSha256;
  payload.target = input.target;
  payload.targetText = input.targetText;
  payload.replacementText = input.replacementText;
  payload.cleanReplacementText = input.cleanReplacementText;
  payload.effectiveMarkdown = input.effectiveMarkdown;
  payload.displayMarkdown = input.displayMarkdown;
  payload.aiBaselineMarkdown = input.aiBaselineMarkdown ?? null;
  payload.aiRawMarkdown = input.aiRawMarkdown ?? null;
  payload.caption = input.caption;
  return JSON.stringify(payload);
}
export type SteelReviewSaveResponse = z.infer<typeof steelReviewSaveResponseSchema>;
export type SteelReviewSourceFile = z.infer<typeof steelReviewSourceFileSchema>;
export type SteelReviewSourcesResponse = z.infer<typeof steelReviewSourcesResponseSchema>;
export type SteelReviewSourcePageCount = z.infer<typeof steelReviewSourcePageCountSchema>;
export type SteelReviewSourceQuery = z.infer<typeof steelReviewSourceQuerySchema>;
export type SteelReviewSourceBinaryQuery = z.infer<typeof steelReviewSourceBinaryQuerySchema>;
