import { z } from 'zod';

export const steelReviewKinds = ['ocr_result', 'system_order'] as const;
export type SteelReviewKind = (typeof steelReviewKinds)[number];

export const steelReviewTitleSchema = z.string().min(1).max(1000);
export type SteelReviewTitleOwner = {
  userId: string;
  tenantId?: string | null;
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  outputId: string;
  title: string;
};

/** Browser-safe canonical bytes shared by the API and data-schema title IDs. */
export function encodeSteelReviewTitleOwner(owner: SteelReviewTitleOwner): string {
  return JSON.stringify({
    namespace: 'steel-review-title-owner-v1',
    owner: [
      owner.userId,
      owner.tenantId ?? null,
      owner.conversationId,
      owner.messageId,
      owner.kind,
      owner.outputId,
      owner.title,
    ],
  });
}

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

export const steelReviewReadQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  title: steelReviewTitleSchema,
}).strict();
export type SteelReviewReadQuery = z.infer<typeof steelReviewReadQuerySchema>;

export const steelReviewReceiptQuerySchema = z.object({
  messageId: z.string().trim().min(1).max(300),
  outputId: z.string().trim().min(1).max(300),
  operationId: z.string().trim().min(1).max(300),
  digest: z.string().length(64),
  title: steelReviewTitleSchema,
}).strict();
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
  // These persisted-row fields stay optional for older stored ledgers while
  // current title-only requests continue to send only row operations.
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

const steelReviewOperationChangeSchema = z.object({
  header: z.string().min(1),
  value: z.string().nullable(),
}).strict();

const steelReviewOperationPositionSchema = z.union([
  z.object({ kind: z.literal('start') }).strict(),
  z.object({ kind: z.literal('end') }).strict(),
  z.object({ kind: z.literal('after'), rowId: z.string().min(1) }).strict(),
]);

const steelReviewOperationSourceSchema = z.union([
  z.object({ fileId: z.null(), pageNumber: z.null() }).strict(),
  z.object({ fileId: z.string().min(1), pageNumber: z.number().int().positive().nullable() }).strict(),
]);

function rejectPresentUndefinedOperationField(value: Record<string, unknown>, context: z.RefinementCtx): void {
  for (const field of ['source', 'position'] as const) {
    if (Object.prototype.hasOwnProperty.call(value, field) && value[field] === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} cannot be undefined` });
    }
  }
}

const steelReviewOperationUpdateSchema = z.object({
  type: z.literal('update'),
  rowId: z.string().min(1),
  changes: z.array(steelReviewOperationChangeSchema).optional(),
  source: steelReviewOperationSourceSchema.optional(),
}).strict().superRefine((value, context) => {
  rejectPresentUndefinedOperationField(value, context);
  if ((!value.changes || value.changes.length === 0) && !Object.prototype.hasOwnProperty.call(value, 'source')) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'An update requires changes or a source intent' });
  }
  if (value.changes && value.changes.length > 0 && new Set(value.changes.map((change) => change.header)).size !== value.changes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: 'An update cannot repeat a field' });
  }
});

const steelReviewOperationAddSchema = z.object({
  type: z.literal('add'),
  rowId: z.string().min(1),
  position: steelReviewOperationPositionSchema,
  changes: z.array(steelReviewOperationChangeSchema).min(1),
  source: steelReviewOperationSourceSchema.optional(),
}).strict().superRefine((value, context) => {
  rejectPresentUndefinedOperationField(value, context);
  if (new Set(value.changes.map((change) => change.header)).size !== value.changes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: 'An add cannot repeat a field' });
  }
});

const steelReviewOperationTransitionSchema = z.object({
  type: z.union([z.literal('delete'), z.literal('restore')]),
  rowId: z.string().min(1),
}).strict();

// The operation branches carry presence refinements (for example, an own
// `source: undefined` is invalid). Zod's discriminatedUnion only accepts raw
// ZodObject branches, so retain the closed discriminating field with a strict
// union instead of dropping those refinements at the transport boundary.
export const steelReviewOperationSchema = z.union([
  steelReviewOperationUpdateSchema,
  steelReviewOperationAddSchema,
  steelReviewOperationTransitionSchema,
]);
export type SteelReviewOperation = z.infer<typeof steelReviewOperationSchema>;

/**
 * The immutable result captured by one successful human save.  This is kept
 * on the receipt rather than read back from the current sidecar so a retry of
 * an older operation cannot accidentally return a later revision.
 */
export const steelReviewSavedSnapshotSchema = z.object({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  requestDigest: z.string().length(64).optional(),
  outputId: z.string().min(1),
  title: steelReviewTitleSchema.optional(),
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
  // These fields are present only on the additive operation receipt lane so
  // an exact retry can return the original prepared projection without
  // rereading or re-preparing against a later revision.
  target: steelReviewTargetSchema.optional(),
  targetText: z.string().optional(),
  replacementText: z.string().optional(),
  cleanReplacementText: z.string().optional(),
  aiBaselineMarkdown: z.string().optional(),
  aiRawMarkdown: z.string().optional(),
  caption: steelReviewCaptionSchema.optional(),
});

export const steelReviewReceiptSchema = z.object({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  requestDigest: z.string().length(64).optional(),
  revision: z.string().min(1),
  title: steelReviewTitleSchema.optional(),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
  savedAt: z.string().datetime(),
  snapshot: steelReviewSavedSnapshotSchema.optional(),
});

export const steelReviewTableSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  outputId: z.string().min(1),
  title: steelReviewTitleSchema,
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

const steelReviewConflictSourceValueSchema = z.object({
  fileId: z.string().nullable(),
  pageNumber: z.number().int().positive().nullable(),
}).nullable();

export const steelReviewConflictSchema = z.union([
  z.object({
    kind: z.literal('field'),
    rowId: z.string().min(1),
    header: z.string().min(1),
    expected: z.string().nullable(),
    current: z.string().nullable(),
    requested: z.string().nullable(),
  }).strict(),
  z.object({
    kind: z.literal('source'),
    rowId: z.string().min(1),
    expected: steelReviewConflictSourceValueSchema,
    current: steelReviewConflictSourceValueSchema,
    requested: steelReviewConflictSourceValueSchema,
  }).strict(),
  z.object({
    kind: z.literal('activity'),
    rowId: z.string().min(1),
    reason: z.enum(['expected-deleted', 'current-deleted', 'current-restored', 'unavailable']),
  }).strict(),
  z.object({
    kind: z.literal('insertion'),
    rowId: z.string().min(1),
    reason: z.enum(['anchor-unavailable', 'anchor-changed', 'identity-duplicated']),
    neededAnchor: z.string().min(1).optional(),
  }).strict(),
]);

export const steelReviewRecoverySchema = z.object({
  table: steelReviewTableSchema.extend({ effectiveMarkdown: z.string() }),
  conflicts: z.array(steelReviewConflictSchema).min(1),
}).strict();

const steelReviewOperationPrepareBaseSchema = z.object({
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  kind: z.enum(steelReviewKinds),
  outputId: z.string().min(1),
  revision: z.string().min(1),
  title: steelReviewTitleSchema,
  operations: z.array(steelReviewOperationSchema).min(1),
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

export const steelReviewOperationPrepareSchema = steelReviewOperationPrepareBaseSchema;
export const steelReviewPrepareSchema = steelReviewOperationPrepareBaseSchema;

const steelReviewPreparedBaseSchema = steelReviewOperationPrepareBaseSchema.extend({
  operationId: z.string().min(1),
  digest: z.string().length(64),
  messageSha256: z.string().length(64),
  target: steelReviewTargetSchema,
  replacementText: z.string(),
  cleanReplacementText: z.string(),
  targetText: z.string(),
  headers: z.array(z.string()),
  rows: z.array(steelReviewRowSchema),
  effectiveMarkdown: z.string(),
  displayMarkdown: z.string(),
  aiBaselineMarkdown: z.string().optional(),
  aiRawMarkdown: z.string().optional(),
  sourceMappings: z.array(steelReviewSourceMappingSchema),
  caption: steelReviewCaptionSchema,
});

const steelReviewPreparedOperationBaseSchema = steelReviewPreparedBaseSchema.extend({
  operations: z.array(steelReviewOperationSchema).min(1),
  operationRequest: steelReviewOperationPrepareBaseSchema,
  requestDigest: z.string().length(64).optional(),
});

export const steelReviewPreparedSchema = z.union([
  steelReviewPreparedBaseSchema.superRefine(rejectPresentInvalidSourceFields),
  steelReviewPreparedOperationBaseSchema,
]);

const steelReviewOperationCommitBaseSchema = steelReviewOperationPrepareBaseSchema.extend({
  operationId: z.string().min(1),
  digest: z.string().length(64),
});

export const steelReviewOperationCommitSchema = steelReviewOperationCommitBaseSchema;
export const steelReviewCommitSchema = steelReviewOperationCommitBaseSchema;

const steelReviewSaveResponseBaseSchema = steelReviewPreparedBaseSchema.extend({
  savedAt: z.string().datetime(),
  changedRows: z.number().int().nonnegative(),
  changedRowIds: z.array(z.string().min(1)),
  savedSnapshot: steelReviewSavedSnapshotSchema.optional(),
}).superRefine(rejectPresentInvalidSourceFields);

export const steelReviewSaveResponseSchema = z.union([
  steelReviewSaveResponseBaseSchema,
  steelReviewPreparedOperationBaseSchema.extend({
    savedAt: z.string().datetime(),
    changedRows: z.number().int().nonnegative(),
    changedRowIds: z.array(z.string().min(1)),
    savedSnapshot: steelReviewSavedSnapshotSchema.optional(),
  }),
]);

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
  recovery: steelReviewRecoverySchema.optional(),
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
  title: steelReviewTitleSchema,
}).strict();

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
export type SteelReviewConflict = z.infer<typeof steelReviewConflictSchema>;
export type SteelReviewRecovery = z.infer<typeof steelReviewRecoverySchema>;

export type SteelReviewOperationApplyResult =
  | { ok: true; currentRows: SteelReviewLedgerRow[]; expectedRows: SteelReviewLedgerRow[] }
  | { ok: false; conflicts: SteelReviewConflict[] };

function operationSourceValue(source: SteelReviewSource | null): { fileId: string; pageNumber: number | null } | null {
  return source ? { fileId: source.fileId, pageNumber: source.pageNumber } : null;
}

function sameOperationBusinessState(
  left: SteelReviewLedgerRow,
  right: SteelReviewLedgerRow,
  headers: readonly string[],
): boolean {
  return JSON.stringify({
    values: Object.fromEntries(headers
      .filter((header) => !isSteelReviewSourceAssociationHeader(header))
      .map((header) => [header, left.values[header]?.effective ?? null])),
    source: operationSourceValue(left.source),
  }) === JSON.stringify({
    values: Object.fromEntries(headers
      .filter((header) => !isSteelReviewSourceAssociationHeader(header))
      .map((header) => [header, right.values[header]?.effective ?? null])),
    source: operationSourceValue(right.source),
  });
}

/** Apply a strict operation request to trusted expected/current ledgers. */
export function applySteelReviewOperations({
  currentRows,
  expectedRows,
  headers,
  operations,
}: {
  currentRows: readonly SteelReviewLedgerRow[];
  expectedRows: readonly SteelReviewLedgerRow[];
  headers: readonly string[];
  operations: readonly SteelReviewOperation[];
}): SteelReviewOperationApplyResult {
  const current = currentRows.map((row) => ({ ...row, values: { ...row.values } }));
  const expected = expectedRows.map((row) => ({ ...row, values: { ...row.values } }));
  const currentById = new Map(current.map((row) => [row.rowId, row]));
  const expectedById = new Map(expected.map((row) => [row.rowId, row]));
  const knownIds = new Set(currentById.keys());
  const seen = new Map<string, SteelReviewOperation['type']>();
  const conflicts: SteelReviewConflict[] = [];
  const nextOrdinal = (kind: string, anchor?: string): number => {
    const key = kind === 'after' && anchor ? `after:${anchor}` : kind;
    const ordinals = current
      .filter((row) => row.insertion && ledgerInsertionKey(row.insertion) === key)
      .map((row) => row.insertion?.ordinal ?? -1);
    return Math.max(-1, ...ordinals) + 1;
  };

  for (const operation of operations) {
    const previousType = seen.get(operation.rowId);
    if (previousType && !(
      (previousType === 'restore' && operation.type === 'update') ||
      (previousType === 'update' && operation.type === 'delete')
    )) {
      conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: 'unavailable' });
      continue;
    }
    seen.set(operation.rowId, operation.type);
    if (operation.type === 'add') {
      if (knownIds.has(operation.rowId) || currentById.has(operation.rowId)) {
        conflicts.push({ kind: 'insertion', rowId: operation.rowId, reason: 'identity-duplicated' });
        continue;
      }
      if (operation.position.kind === 'after') {
        const anchor = currentById.get(operation.position.rowId);
        const expectedAnchor = expectedById.get(operation.position.rowId);
        if (!anchor || anchor.deleted || !expectedAnchor || expectedAnchor.deleted) {
          conflicts.push({
            kind: 'insertion',
            rowId: operation.rowId,
            reason: 'anchor-unavailable',
            neededAnchor: operation.position.rowId,
          });
          continue;
        }
      }
      const values: Record<string, SteelReviewCell> = Object.fromEntries(
        headers.map((header) => [header, { baseline: null, effective: null }]),
      );
      for (const change of operation.changes) {
        values[change.header] = { baseline: null, effective: normalizeSteelReviewEffectiveValue(change.value) };
      }
      const insertion = operation.position.kind === 'after'
        ? { kind: operation.position.kind, rowId: operation.position.rowId, ordinal: nextOrdinal('after', operation.position.rowId) }
        : { kind: operation.position.kind, ordinal: nextOrdinal(operation.position.kind) };
      const row: SteelReviewLedgerRow = {
        rowId: operation.rowId,
        values,
        source: null,
        origin: 'manual',
        deleted: false,
        insertion,
      };
      current.push(row);
      currentById.set(row.rowId, row);
      continue;
    }
    const row = currentById.get(operation.rowId);
    const expectedRow = expectedById.get(operation.rowId);
    if (!row) {
      conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: 'unavailable' });
      continue;
    }
    if (operation.type === 'update') {
      if (!expectedRow || expectedRow.deleted || row.deleted) {
        let reason: 'expected-deleted' | 'current-deleted' | 'unavailable' = 'unavailable';
        if (expectedRow?.deleted) {
          reason = 'expected-deleted';
        } else if (row.deleted) {
          reason = 'current-deleted';
        }
        conflicts.push({
          kind: 'activity',
          rowId: operation.rowId,
          reason,
        });
        continue;
      }
      for (const change of operation.changes ?? []) {
        const requestedValue = normalizeSteelReviewEffectiveValue(change.value);
        const currentValue = row.values[change.header]?.effective ?? null;
        const expectedValue = expectedRow.values[change.header]?.effective ?? null;
        if (currentValue !== expectedValue && currentValue !== requestedValue) {
          conflicts.push({
            kind: 'field', rowId: row.rowId, header: change.header,
            expected: expectedValue, current: currentValue, requested: requestedValue,
          });
          continue;
        }
        row.values[change.header] = { ...row.values[change.header], effective: requestedValue };
        expectedRow.values[change.header] = { ...expectedRow.values[change.header], effective: requestedValue };
      }
      if (operation.source) {
        const expectedSource = operationSourceValue(expectedRow.source);
        const currentSource = operationSourceValue(row.source);
        const requestedSource = operation.source.fileId === null
          ? null
          : { fileId: operation.source.fileId, pageNumber: operation.source.pageNumber };
        if (JSON.stringify(currentSource) !== JSON.stringify(expectedSource) &&
          JSON.stringify(currentSource) !== JSON.stringify(requestedSource)) {
          conflicts.push({ kind: 'source', rowId: row.rowId, expected: expectedSource, current: currentSource, requested: requestedSource });
        } else {
          row.source = requestedSource
            ? { fileId: requestedSource.fileId, pageNumber: requestedSource.pageNumber }
            : null;
          expectedRow.source = requestedSource
            ? { fileId: requestedSource.fileId, pageNumber: requestedSource.pageNumber }
            : null;
        }
      }
      continue;
    }
    if (operation.type === 'delete') {
      if (!expectedRow) {
        conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: 'unavailable' });
      } else if (expectedRow.deleted && row.deleted) {
        continue;
      } else if (expectedRow.deleted) {
        conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: 'expected-deleted' });
      } else if (row.deleted) {
        expectedRow.deleted = true;
      } else if (!sameOperationBusinessState(row, expectedRow, headers)) {
        conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: 'current-deleted' });
      } else {
        row.deleted = true;
        expectedRow.deleted = true;
      }
      continue;
    }
    if (!expectedRow || !expectedRow.deleted || !sameOperationBusinessState(row, expectedRow, headers)) {
      conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: expectedRow?.deleted ? 'current-restored' : 'unavailable' });
      continue;
    }
    if (!row.deleted) {
      expectedRow.deleted = false;
      continue;
    }
    row.deleted = false;
    expectedRow.deleted = false;
  }
  return conflicts.length > 0
    ? { ok: false, conflicts }
    : {
        ok: true,
        currentRows: orderSteelReviewLedgerRows(current),
        expectedRows: orderSteelReviewLedgerRows(expected),
      };
}
export type SteelReviewResponse = z.infer<typeof steelReviewResponseSchema>;
export type SteelReviewReceiptStatus = z.infer<typeof steelReviewReceiptStatusSchema>;
export type SteelReviewErrorResponse = z.infer<typeof steelReviewErrorResponseSchema>;
export type SteelReviewTarget = z.infer<typeof steelReviewTargetSchema>;
export type SteelReviewCaption = z.infer<typeof steelReviewCaptionSchema>;
export type SteelReviewSavedSnapshot = z.infer<typeof steelReviewSavedSnapshotSchema>;
export type SteelReviewReceipt = z.infer<typeof steelReviewReceiptSchema>;
export type SteelReviewOperationPrepare = z.infer<typeof steelReviewOperationPrepareSchema>;
export type SteelReviewOperationCommit = z.infer<typeof steelReviewOperationCommitSchema>;
export type SteelReviewPrepare = z.infer<typeof steelReviewPrepareSchema>;
export type SteelReviewPrepared = z.infer<typeof steelReviewPreparedSchema>;
export type SteelReviewCommit = z.infer<typeof steelReviewCommitSchema>;
export type SteelReviewOperationPrepared = z.infer<typeof steelReviewPreparedOperationBaseSchema>;

export type SteelReviewDigestInput = {
  conversationId: string;
  messageId: string;
  kind: SteelReviewKind;
  title: string;
  outputId: string;
  revision: string;
  operationId: string;
  operations: SteelReviewOperation[];
  userId: string;
  tenantId?: string | null;
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

function orderSteelReviewLedgerRows(rows: readonly SteelReviewLedgerRow[]): SteelReviewLedgerRow[] {
  const currentIndex = new Map(rows.map((row, index) => [row.rowId, index]));
  const children = new Map<string, SteelReviewLedgerRow[]>();
  const starts: SteelReviewLedgerRow[] = [];
  const ends: SteelReviewLedgerRow[] = [];
  const roots: SteelReviewLedgerRow[] = [];
  const rowIds = new Set(rows.map((row) => row.rowId));
  for (const row of rows) {
    const insertion = row.insertion;
    if (!insertion || row.origin !== 'manual') {
      roots.push(row);
      continue;
    }
    if (insertion.kind === 'start') {
      starts.push(row);
    } else if (insertion.kind === 'end') {
      ends.push(row);
    } else if (insertion.kind === 'after' && insertion.rowId && rowIds.has(insertion.rowId)) {
      const siblings = children.get(insertion.rowId) ?? [];
      siblings.push(row);
      children.set(insertion.rowId, siblings);
    } else {
      // Validation reports a missing anchor for new rows. Existing data may
      // contain one from an older writer; keep it deterministic at the end.
      ends.push(row);
    }
  }
  const sortByOrdinal = (left: SteelReviewLedgerRow, right: SteelReviewLedgerRow) =>
    (left.insertion?.ordinal ?? 0) - (right.insertion?.ordinal ?? 0) ||
    (currentIndex.get(left.rowId) ?? 0) - (currentIndex.get(right.rowId) ?? 0);
  const ordered: SteelReviewLedgerRow[] = [];
  const emitted = new Set<string>();
  const emit = (row: SteelReviewLedgerRow) => {
    if (emitted.has(row.rowId)) return;
    emitted.add(row.rowId);
    ordered.push(row);
    for (const child of [...(children.get(row.rowId) ?? [])].sort(sortByOrdinal)) emit(child);
  };
  for (const row of [...starts].sort(sortByOrdinal)) emit(row);
  for (const row of roots) emit(row);
  for (const row of [...ends].sort(sortByOrdinal)) emit(row);
  for (const row of rows) emit(row);
  return ordered;
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

  const submittedById = new Map(submitted.map((row) => [row.rowId, row]));
  const newRows = submitted.filter((row) => !currentById.has(row.rowId));
  const orderedRows = orderSteelReviewLedgerRows([...current, ...newRows]);
  const orderedSubmittedRows = orderedRows.map((row) => submittedById.get(row.rowId) ?? row);
  return { ok: true, currentRows: current, submittedRows: submitted, orderedRows, orderedSubmittedRows };
}

/** Keep the wire digest's field order and null semantics in one browser-safe encoder. */
export function encodeSteelReviewDigest(input: SteelReviewDigestInput): string {
  return JSON.stringify({
    namespace: 'steel-review-operation-v2',
    owner: [
      input.userId,
      input.tenantId ?? null,
      input.conversationId,
      input.messageId,
      input.kind,
      input.title,
      input.outputId,
      input.revision,
      input.operationId,
    ],
    operations: input.operations,
  });
}
export type SteelReviewSaveResponse = z.infer<typeof steelReviewSaveResponseSchema>;
export type SteelReviewSourceFile = z.infer<typeof steelReviewSourceFileSchema>;
export type SteelReviewSourcesResponse = z.infer<typeof steelReviewSourcesResponseSchema>;
export type SteelReviewSourcePageCount = z.infer<typeof steelReviewSourcePageCountSchema>;
export type SteelReviewSourceQuery = z.infer<typeof steelReviewSourceQuerySchema>;
export type SteelReviewSourceBinaryQuery = z.infer<typeof steelReviewSourceBinaryQuerySchema>;
