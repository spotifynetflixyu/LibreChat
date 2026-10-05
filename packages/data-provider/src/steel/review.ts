import { z } from 'zod';
import type { SteelProcessingMeasurement } from './calculation';
import type { SteelCatalogSelectionEvidence } from './catalog';
import type { SteelCatalogCandidate } from './catalog';
import { steelMaterialCandidateHeaders, applyMaterialCandidate, steelCatalogSelectionEvidenceSchema, steelCatalogSelectionSchema } from './catalog';
import { calculateSteelProcessingMeasurement, calculateSteelSystemOrderRow, steelProcessingMeasurementSchema } from './calculation';
import { steelCalculationRowMetadataSchema } from './calculation';

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
  'CATALOG_CHANGED',
]);
export type SteelReviewErrorCode = z.infer<typeof steelReviewErrorCodeSchema>;

export const steelReviewOwnerUpdatedSchema = z.object({
  version: z.literal(1),
  kind: z.enum(steelReviewKinds),
  conversationId: z.string().min(1),
  messageId: z.string().min(1),
  title: steelReviewTitleSchema,
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

export const steelReviewSystemKindSchema = z.enum(['material', 'processing', 'unassigned']);
export type SteelReviewSystemKind = z.infer<typeof steelReviewSystemKindSchema>;

export const steelReviewSystemStateSchema = z.object({
  kind: steelReviewSystemKindSchema,
  parentRowId: z.string().min(1).nullable(),
  cascadeDeletedBy: z.string().min(1).nullable(),
}).strict().superRefine((state, context) => {
  if (state.kind !== 'processing' && state.parentRowId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['parentRowId'], message: 'Only processing rows may have a parent' });
  }
  if (state.kind !== 'processing' && state.cascadeDeletedBy !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['cascadeDeletedBy'], message: 'Only processing rows may have cascade provenance' });
  }
  if (state.cascadeDeletedBy !== null && state.kind !== 'processing') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['cascadeDeletedBy'], message: 'Cascade provenance requires processing' });
  }
});

const steelReviewSystemCategoryHeaders = new Set(['類別', '分類', 'category', 'type']);

/**
 * Project the persisted system-order relationship from the same category
 * evidence used by the API and the first-save database baseline.
 */
export function inferSteelReviewSystemState(
  headers: readonly string[],
  values: readonly string[],
): SteelReviewSystemState | undefined {
  const categoryIndex = headers.findIndex((header) => {
    const normalized = header.trim().toLowerCase().replace(/[\s_]+/g, '');
    return steelReviewSystemCategoryHeaders.has(normalized);
  });
  if (categoryIndex < 0) {
    return undefined;
  }
  const category = values[categoryIndex]?.trim() ?? '';
  let kind: SteelReviewSystemKind;
  if (category.length === 0) {
    kind = 'unassigned';
  } else if (category.startsWith('加工/')) {
    kind = 'processing';
  } else {
    kind = 'material';
  }
  return {
    kind,
    parentRowId: null,
    cascadeDeletedBy: null,
  };
}

function steelReviewCellText(row: SteelReviewRow, header: string): string {
  const cell = row.values[header];
  return (cell?.effective ?? cell?.baseline ?? '').trim();
}

/**
 * Bind fresh system-order processing rows to uniquely identified materials.
 * The producer writes the child part number as the complete processing remark;
 * ambiguous or missing identifiers intentionally remain unbound.
 */
export function initializeFreshSteelReviewSystemRows(
  headers: readonly string[],
  rows: readonly SteelReviewRow[],
): SteelReviewRow[] {
  if (!headers.includes('備註')) {
    return rows.map((row) => ({ ...row }));
  }
  const materialsByPartNumber = new Map<string, SteelReviewRow[]>();
  rows.forEach((row) => {
    if (row.system?.kind !== 'material' || row.deleted) return;
    const partNumber = steelReviewCellText(row, '備註');
    if (!partNumber) return;
    const matches = materialsByPartNumber.get(partNumber) ?? [];
    matches.push(row);
    materialsByPartNumber.set(partNumber, matches);
  });
  return rows.map((row) => {
    if (row.system?.kind !== 'processing') {
      return { ...row };
    }
    const partNumber = steelReviewCellText(row, '備註');
    const matches = partNumber ? materialsByPartNumber.get(partNumber) ?? [] : [];
    if (matches.length !== 1) {
      return {
        ...row,
        source: null,
        system: { ...row.system, parentRowId: null, cascadeDeletedBy: null },
      };
    }
    const [parent] = matches;
    return {
      ...row,
      source: parent.source ? { ...parent.source } : null,
      system: { ...row.system, parentRowId: parent.rowId, cascadeDeletedBy: null },
    };
  });
}

export const steelReviewRowSchema = z.object({
  rowId: z.string().min(1),
  values: z.record(z.string(), steelReviewCellSchema),
  source: steelReviewSourceSchema.nullable(),
  // These persisted-row fields stay optional for older stored ledgers while
  // current title-only requests continue to send only row operations.
  origin: steelReviewRowOriginSchema.optional(),
  deleted: z.boolean().optional(),
  insertion: steelReviewRowInsertionSchema.optional(),
  system: steelReviewSystemStateSchema.optional(),
  calculation: steelCalculationRowMetadataSchema.optional(),
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
  customerQuoteChangedRows: z.number().int().nonnegative().optional(),
  customerQuoteTotal: z.string().nullable().optional(),
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

const steelReviewOperationSystemSchema = z.object({
  kind: steelReviewSystemKindSchema,
  parentRowId: z.string().min(1).nullable(),
}).strict().superRefine((state, context) => {
  if (state.kind !== 'processing' && state.parentRowId !== null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['parentRowId'], message: 'Only processing rows may have a parent' });
  }
});

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
  binding: z.object({ parentRowId: z.string().min(1).nullable() }).strict().optional(),
  measurement: steelProcessingMeasurementSchema.nullable().optional(),
}).strict().superRefine((value, context) => {
  rejectPresentUndefinedOperationField(value, context);
  if ((!value.changes || value.changes.length === 0) &&
    !Object.prototype.hasOwnProperty.call(value, 'source') &&
    !Object.prototype.hasOwnProperty.call(value, 'binding') &&
    !Object.prototype.hasOwnProperty.call(value, 'measurement')) {
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
  system: steelReviewOperationSystemSchema.optional(),
  measurement: steelProcessingMeasurementSchema.optional(),
}).strict().superRefine((value, context) => {
  rejectPresentUndefinedOperationField(value, context);
  if (new Set(value.changes.map((change) => change.header)).size !== value.changes.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['changes'], message: 'An add cannot repeat a field' });
  }
});

const steelReviewOperationClassifySchema = z.object({
  type: z.literal('classify'),
  rowId: z.string().min(1),
  system: steelReviewOperationSystemSchema,
}).strict();

const steelReviewOperationTransitionSchema = z.object({
  type: z.union([z.literal('delete'), z.literal('restore')]),
  rowId: z.string().min(1),
}).strict();

const steelReviewOperationReplaceMaterialSchema = z.object({
  type: z.literal('replace_material'),
  rowId: z.string().min(1),
  selection: steelCatalogSelectionSchema,
}).strict();

// The operation branches carry presence refinements (for example, an own
// `source: undefined` is invalid). Zod's discriminatedUnion only accepts raw
// ZodObject branches, so retain the closed discriminating field with a strict
// union instead of dropping those refinements at the transport boundary.
export const steelReviewOperationSchema = z.union([
  steelReviewOperationUpdateSchema,
  steelReviewOperationAddSchema,
  steelReviewOperationClassifySchema,
  steelReviewOperationTransitionSchema,
  steelReviewOperationReplaceMaterialSchema,
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
  selectionEvidence: z.array(steelCatalogSelectionEvidenceSchema).optional(),
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
  z.object({
    kind: z.literal('binding'),
    rowId: z.string().min(1),
    expected: z.string().nullable(),
    current: z.string().nullable(),
    requested: z.string().nullable(),
  }).strict(),
  z.object({
    kind: z.literal('measurement'),
    rowId: z.string().min(1),
    expected: steelProcessingMeasurementSchema.nullable(),
    current: steelProcessingMeasurementSchema.nullable(),
    requested: steelProcessingMeasurementSchema.nullable(),
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
  selectionEvidence: z.array(steelCatalogSelectionEvidenceSchema).optional(),
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
export type SteelReviewSystemState = z.infer<typeof steelReviewSystemStateSchema>;
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
    system: left.system ?? null,
    calculation: left.calculation ?? null,
  }) === JSON.stringify({
    values: Object.fromEntries(headers
      .filter((header) => !isSteelReviewSourceAssociationHeader(header))
      .map((header) => [header, right.values[header]?.effective ?? null])),
    source: operationSourceValue(right.source),
    system: right.system ?? null,
    calculation: right.calculation ?? null,
  });
}

function relationState(row: SteelReviewLedgerRow): SteelReviewSystemState | null {
  return row.system ?? null;
}

function relationParentId(row: SteelReviewLedgerRow): string | null {
  return row.system?.kind === 'processing' ? row.system.parentRowId : null;
}

function sameRelationState(left: SteelReviewLedgerRow, right: SteelReviewLedgerRow): boolean {
  return JSON.stringify(relationState(left)) === JSON.stringify(relationState(right));
}

function requestedRelationState(requested: Pick<SteelReviewSystemState, 'kind' | 'parentRowId'> & Partial<Pick<SteelReviewSystemState, 'cascadeDeletedBy'>>): SteelReviewSystemState {
  return {
    kind: requested.kind,
    parentRowId: requested.kind === 'processing' ? requested.parentRowId : null,
    cascadeDeletedBy: requested.kind === 'processing'
      ? requested.cascadeDeletedBy ?? null
      : null,
  };
}

function relationConflict(
  row: SteelReviewLedgerRow,
  expectedRow: SteelReviewLedgerRow,
  requested: Pick<SteelReviewSystemState, 'kind' | 'parentRowId'>,
): SteelReviewConflict {
  return {
    kind: 'binding',
    rowId: row.rowId,
    expected: relationParentId(expectedRow),
    current: relationParentId(row),
    requested: requested.kind === 'processing' ? requested.parentRowId : null,
  };
}

function cloneReviewCalculation(calculation: SteelReviewRow['calculation']): SteelReviewRow['calculation'] {
  if (!calculation) return undefined;
  return {
    ...(calculation.candidate ? {
      candidate: {
        ...calculation.candidate,
        exactPhysical: { ...calculation.candidate.exactPhysical },
      },
    } : {}),
    ...(calculation.measurement ? {
      measurement: {
        ...calculation.measurement,
        ...(calculation.measurement.mode === 'cutting'
          ? { groups: calculation.measurement.groups.map((group) => ({ ...group })) }
          : {}),
      },
    } : {}),
    ...(calculation.fields ? {
      fields: Object.fromEntries(Object.entries(calculation.fields).map(([header, field]) => [header, {
        ...field,
        ...(field.dependencies ? { dependencies: { ...field.dependencies } } : {}),
      }])),
    } : {}),
  };
}

function setProcessingMeasurement(
  row: SteelReviewLedgerRow,
  measurement: SteelProcessingMeasurement | null | undefined,
): void {
  if (measurement === undefined) return;
  const calculation = cloneReviewCalculation(row.calculation) ?? {};
  if (measurement === null) {
    delete calculation.measurement;
  } else {
    calculation.measurement = {
      ...measurement,
      ruleVersion: 'v1',
      ...(measurement.mode === 'cutting'
        ? { groups: measurement.groups.map((group) => ({ ...group })) }
        : {}),
    };
  }
  row.calculation = {
    ...(calculation.candidate ? { candidate: calculation.candidate } : {}),
    ...(calculation.measurement ? { measurement: calculation.measurement } : {}),
    ...(calculation.fields ? { fields: calculation.fields } : {}),
  };
}

function cloneLedgerRow(row: SteelReviewLedgerRow): SteelReviewLedgerRow {
  return {
    ...row,
    values: Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [header, { ...cell }])),
    source: row.source ? { ...row.source } : null,
    ...(row.insertion ? { insertion: { ...row.insertion } } : {}),
    ...(row.system ? { system: { ...row.system } } : {}),
    ...(row.calculation ? { calculation: cloneReviewCalculation(row.calculation) } : {}),
  };
}

function applyRowCalculation(
  row: SteelReviewLedgerRow,
  expectedRow: SteelReviewLedgerRow,
  headers: readonly string[],
  changedHeaders: readonly string[],
): SteelReviewConflict[] {
  if (changedHeaders.length === 0) return [];
  const fields = { ...(row.calculation?.fields ?? {}) };
  for (const header of changedHeaders) fields[header] = { kind: 'manual' };
  const candidate = row.calculation?.candidate;
  const calculated = calculateSteelSystemOrderRow({
    headers,
    values: headers.map((header) => row.values[header]?.effective ?? ''),
    ...(candidate ? { candidate } : {}),
    changedHeaders,
    provenance: fields,
    systemKind: row.system?.kind ?? 'unassigned',
  });
  const recalculatedHeaders = new Set(calculated.calculatedHeaders);
  const acceptedHeaders = new Set(changedHeaders);
  const conflicts: SteelReviewConflict[] = [];
  headers.forEach((header, index) => {
    if (!acceptedHeaders.has(header) && !recalculatedHeaders.has(header)) return;
    const next = calculated.values[index] ?? '';
    const current = row.values[header]?.effective ?? null;
    const expected = expectedRow.values[header]?.effective ?? null;
    const provenance = calculated.provenance?.[header];
    const currentField = row.calculation?.fields?.[header];
    const expectedField = expectedRow.calculation?.fields?.[header];
    const provenanceChanged = JSON.stringify(currentField ?? null) !== JSON.stringify(expectedField ?? null);
    const sameDerivedBasis = (currentField?.candidateCode ?? null) === (provenance?.candidateCode ?? null) &&
      (currentField?.ruleVersion ?? null) === (provenance?.ruleVersion ?? null);
    const compatibleDerivedBasis = currentField?.candidateCode === undefined || provenance?.candidateCode === undefined;
    const trustedDerivedMerge = provenance?.kind === 'derived' && currentField?.kind === 'derived' &&
      (sameDerivedBasis || compatibleDerivedBasis);
    const hasConcurrentChange = current !== expected || provenanceChanged;
    if (current !== next) {
      if (hasConcurrentChange && !trustedDerivedMerge && provenance?.kind === 'derived') {
        conflicts.push({ kind: 'field', rowId: row.rowId, header, expected, current, requested: next });
        return;
      }
      row.values[header] = { ...(row.values[header] ?? { baseline: null, effective: null }), effective: next };
    }
    if (changedHeaders.includes(header)) {
      fields[header] = { kind: 'manual' };
    } else if (recalculatedHeaders.has(header) && provenance) {
      fields[header] = provenance;
    }
    expectedRow.values[header] = {
      ...(expectedRow.values[header] ?? { baseline: null, effective: null }),
      effective: next,
    };
  });
  const nextCandidate = candidate &&
    (row.values['型號']?.effective ?? '') === candidate.erpItemCode &&
    (row.values['類別']?.effective ?? '') === candidate.category
    ? candidate : undefined;
  if (!nextCandidate && candidate && (changedHeaders.includes('型號') || changedHeaders.includes('類別'))) {
    for (const [header, field] of Object.entries(fields)) {
      if (field.kind === 'derived' && field.candidateCode === candidate.erpItemCode) delete fields[header];
    }
  }
  row.calculation = {
    ...(nextCandidate ? { candidate: nextCandidate } : {}),
    ...(row.calculation?.measurement ? { measurement: row.calculation.measurement } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
  const expectedCalculation = cloneReviewCalculation(expectedRow.calculation) ?? {};
  if (nextCandidate && (changedHeaders.includes('型號') || changedHeaders.includes('類別') || recalculatedHeaders.size > 0)) {
    expectedCalculation.candidate = {
      ...nextCandidate,
      exactPhysical: { ...nextCandidate.exactPhysical },
    };
  } else if (!nextCandidate && (changedHeaders.includes('型號') || changedHeaders.includes('類別'))) {
    delete expectedCalculation.candidate;
    if (expectedCalculation.fields) {
      for (const [header, field] of Object.entries(expectedCalculation.fields)) {
        if (field.kind === 'derived' && field.candidateCode === candidate?.erpItemCode) delete expectedCalculation.fields[header];
      }
    }
  }
  const expectedFields = { ...(expectedCalculation.fields ?? {}) };
  for (const header of changedHeaders) expectedFields[header] = { kind: 'manual' };
  recalculatedHeaders.forEach((header) => {
    const provenance = fields[header];
    if (provenance) expectedFields[header] = {
      ...provenance,
      ...(provenance.dependencies ? { dependencies: { ...provenance.dependencies } } : {}),
    };
  });
  expectedRow.calculation = {
    ...(expectedCalculation.candidate ? { candidate: expectedCalculation.candidate } : {}),
    ...(expectedCalculation.measurement ? { measurement: expectedCalculation.measurement } : {}),
    ...(Object.keys(expectedFields).length > 0 ? { fields: expectedFields } : {}),
  };
  return conflicts;
}

function sameProcessingMeasurement(
  left: NonNullable<SteelReviewLedgerRow['calculation']>['measurement'] | null | undefined,
  right: NonNullable<SteelReviewLedgerRow['calculation']>['measurement'] | null | undefined,
): boolean {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function applyProcessingRowCalculation(
  row: SteelReviewLedgerRow,
  expectedRow: SteelReviewLedgerRow,
  parent: SteelReviewLedgerRow | undefined,
  expectedParent: SteelReviewLedgerRow | undefined,
  headers: readonly string[],
  allowManualOverride = true,
): SteelReviewConflict[] {
  if (row.system?.kind !== 'processing' || row.deleted) {
    return [];
  }
  const measurement = row.calculation?.measurement;
  if (!measurement) return [];
  if (measurement.mode !== 'batch' && (!parent || !expectedParent || parent.deleted ||
    parent.system?.kind !== 'material' || expectedParent.deleted || expectedParent.system?.kind !== 'material')) {
    return [];
  }
  const totalHeader = headers.includes('總數') ? '總數' : undefined;
  if (!totalHeader) return [];
  const currentTotal = row.values[totalHeader]?.effective ?? null;
  const expectedTotal = expectedRow.values[totalHeader]?.effective ?? null;
  const currentField = row.calculation?.fields?.[totalHeader];
  const conflicts: SteelReviewConflict[] = [];
  if (currentTotal !== expectedTotal && currentField?.kind === 'manual') {
    conflicts.push({ kind: 'field', rowId: row.rowId, header: totalHeader, expected: expectedTotal, current: currentTotal, requested: currentTotal });
    return conflicts;
  }
  const result = calculateSteelProcessingMeasurement({
    headers,
    values: headers.map((header) => row.values[header]?.effective ?? ''),
    measurement,
    parentHeaders: headers,
    parentValues: parent ? headers.map((header) => parent.values[header]?.effective ?? '') : [],
  });
  if (result === undefined || (!allowManualOverride && currentField?.kind === 'manual')) return conflicts;
  const provenance: SteelReviewFieldProvenance = {
    kind: 'derived',
    ruleVersion: 'v1',
    dependencies: {
      ...(parent ? { parentRowId: parent.rowId } : {}),
      measurement: JSON.stringify(measurement),
    },
  };
  if (currentTotal !== result && currentTotal !== expectedTotal && currentField?.kind !== 'derived') {
    conflicts.push({ kind: 'field', rowId: row.rowId, header: totalHeader, expected: expectedTotal, current: currentTotal, requested: result });
    return conflicts;
  }
  row.values[totalHeader] = {
    ...(row.values[totalHeader] ?? { baseline: null, effective: null }),
    effective: result,
  };
  expectedRow.values[totalHeader] = {
    ...(expectedRow.values[totalHeader] ?? { baseline: null, effective: null }),
    effective: result,
  };
  const fields = { ...(row.calculation?.fields ?? {}), [totalHeader]: provenance };
  row.calculation = {
    ...(row.calculation?.candidate ? { candidate: row.calculation.candidate } : {}),
    measurement,
    fields,
  };
  const expectedFields = { ...(expectedRow.calculation?.fields ?? {}), [totalHeader]: provenance };
  expectedRow.calculation = {
    ...(expectedRow.calculation?.candidate ? { candidate: expectedRow.calculation.candidate } : {}),
    measurement,
    fields: expectedFields,
  };
  return conflicts;
}

type SteelReviewFieldProvenance = NonNullable<NonNullable<SteelReviewRow['calculation']>['fields']>[string];

function clearProcessingDerivedProvenance(row: SteelReviewLedgerRow): void {
  const fields = { ...(row.calculation?.fields ?? {}) };
  if (fields['總數']?.kind === 'derived') delete fields['總數'];
  row.calculation = {
    ...(row.calculation?.candidate ? { candidate: row.calculation.candidate } : {}),
    ...(row.calculation?.measurement ? { measurement: row.calculation.measurement } : {}),
    ...(Object.keys(fields).length > 0 ? { fields } : {}),
  };
}

function recalculateChildrenForParent(
  parent: SteelReviewLedgerRow,
  currentRows: readonly SteelReviewLedgerRow[],
  expectedById: ReadonlyMap<string, SteelReviewLedgerRow>,
  currentById: ReadonlyMap<string, SteelReviewLedgerRow>,
  headers: readonly string[],
): SteelReviewConflict[] {
  if (parent.system?.kind !== 'material' || parent.deleted) return [];
  const conflicts: SteelReviewConflict[] = [];
  for (const child of currentRows) {
    if (child.system?.kind !== 'processing' || child.system.parentRowId !== parent.rowId || child.deleted) continue;
    const expectedChild = expectedById.get(child.rowId);
    const currentParent = currentById.get(parent.rowId);
    const expectedParent = expectedById.get(parent.rowId);
    if (!expectedChild || !currentParent || !expectedParent) continue;
    conflicts.push(...applyProcessingRowCalculation(child, expectedChild, currentParent, expectedParent, headers));
  }
  return conflicts;
}

function stageBinding(
  row: SteelReviewLedgerRow,
  expectedRow: SteelReviewLedgerRow,
  requested: Pick<SteelReviewSystemState, 'kind' | 'parentRowId'> & Partial<Pick<SteelReviewSystemState, 'cascadeDeletedBy'>>,
  currentById: Map<string, SteelReviewLedgerRow>,
  expectedById: Map<string, SteelReviewLedgerRow>,
  conflicts: SteelReviewConflict[],
): void {
  const next = requestedRelationState(requested);
  if (row.deleted || expectedRow.deleted) {
    conflicts.push({ kind: 'activity', rowId: row.rowId, reason: row.deleted ? 'current-deleted' : 'expected-deleted' });
    return;
  }
  if (next.kind === 'processing') {
    if (!next.parentRowId) {
      conflicts.push(relationConflict(row, expectedRow, next));
      return;
    }
    const parent = currentById.get(next.parentRowId);
    const expectedParent = expectedById.get(next.parentRowId);
    if (!parent || !expectedParent || parent.deleted || expectedParent.deleted || parent.system?.kind !== 'material' || expectedParent.system?.kind !== 'material') {
      conflicts.push({ kind: 'binding', rowId: row.rowId, expected: relationParentId(expectedRow), current: relationParentId(row), requested: next.parentRowId });
      return;
    }
  } else if (next.kind === 'material' && next.parentRowId !== null) {
    conflicts.push(relationConflict(row, expectedRow, next));
    return;
  }
  if (!sameRelationState(row, expectedRow) && !sameRelationState(row, { ...expectedRow, system: next })) {
    conflicts.push(relationConflict(row, expectedRow, next));
    return;
  }
  row.system = next;
  expectedRow.system = next;
}

/** Apply a strict operation request to trusted expected/current ledgers. */
export function applySteelReviewOperations({
  currentRows,
  expectedRows,
  headers,
  operations,
  materialCandidates,
}: {
  currentRows: readonly SteelReviewLedgerRow[];
  expectedRows: readonly SteelReviewLedgerRow[];
  headers: readonly string[];
  operations: readonly SteelReviewOperation[];
  materialCandidates?: ReadonlyMap<string, SteelCatalogCandidate>;
}): SteelReviewOperationApplyResult {
  const current = currentRows.map(cloneLedgerRow);
  const expected = expectedRows.map(cloneLedgerRow);
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
      (previousType === 'restore' && (operation.type === 'classify' || operation.type === 'update')) ||
      (previousType === 'classify' && (operation.type === 'update' || operation.type === 'delete')) ||
      (previousType === 'update' && (operation.type === 'delete' || operation.type === 'replace_material')) ||
      (previousType === 'replace_material' && (operation.type === 'update' || operation.type === 'delete'))
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
        ...(operation.system ? { system: requestedRelationState(operation.system) } : {}),
      };
      if (operation.measurement !== undefined) {
        setProcessingMeasurement(row, operation.measurement);
      }
      if (row.system?.kind === 'processing') {
        const parent = row.system.parentRowId ? currentById.get(row.system.parentRowId) : undefined;
        const expectedParent = row.system.parentRowId ? expectedById.get(row.system.parentRowId) : undefined;
        if (!parent || parent.deleted || parent.system?.kind !== 'material' ||
          !expectedParent || expectedParent.deleted || expectedParent.system?.kind !== 'material') {
          conflicts.push({ kind: 'binding', rowId: row.rowId, expected: null, current: null, requested: row.system.parentRowId });
          continue;
        }
      }
      const expectedRow: SteelReviewLedgerRow = {
        ...row,
        values: Object.fromEntries(Object.entries(row.values).map(([header, cell]) => [header, { ...cell }])),
        source: row.source ? { ...row.source } : null,
        ...(row.insertion ? { insertion: { ...row.insertion } } : {}),
        ...(row.system ? { system: { ...row.system } } : {}),
      };
      for (const change of operation.changes) {
        const requestedValue = normalizeSteelReviewEffectiveValue(change.value);
        row.values[change.header] = {
          ...(row.values[change.header] ?? { baseline: null, effective: null }),
          effective: requestedValue,
        };
        expectedRow.values[change.header] = {
          ...(expectedRow.values[change.header] ?? { baseline: null, effective: null }),
          effective: requestedValue,
        };
        conflicts.push(...applyRowCalculation(row, expectedRow, headers, [change.header]));
      }
      if (operation.system?.kind === 'processing' && operation.measurement !== undefined) {
        const parent = operation.system.parentRowId ? currentById.get(operation.system.parentRowId) : undefined;
        const expectedParent = operation.system.parentRowId ? expectedById.get(operation.system.parentRowId) : undefined;
        conflicts.push(...applyProcessingRowCalculation(
          row,
          expectedRow,
          parent,
          expectedParent,
          headers,
          !operation.changes.some((change) => change.header === '總數'),
        ));
      }
      current.push(row);
      currentById.set(row.rowId, row);
      expected.push(expectedRow);
      expectedById.set(expectedRow.rowId, expectedRow);
      continue;
    }
    const row = currentById.get(operation.rowId);
    const expectedRow = expectedById.get(operation.rowId);
    if (!row) {
      conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: 'unavailable' });
      continue;
    }
    if (operation.type === 'replace_material') {
      const candidate = materialCandidates?.get(operation.rowId);
      if (!candidate || !expectedRow || expectedRow.deleted || row.deleted || expectedRow.system?.kind !== 'material' || row.system?.kind !== 'material') {
        conflicts.push({ kind: 'activity', rowId: operation.rowId, reason: row.deleted ? 'current-deleted' : 'unavailable' });
        continue;
      }
      const next = applyMaterialCandidate(row, candidate, headers, operation.selection.evidence.tier);
      const nextExpected = applyMaterialCandidate(expectedRow, candidate, headers, operation.selection.evidence.tier);
      const candidateConflicts = steelMaterialCandidateHeaders.filter((header) => headers.includes(header) &&
        (row.values[header]?.effective ?? null) !== (expectedRow.values[header]?.effective ?? null) &&
        (row.values[header]?.effective ?? null) !== (next.values[header]?.effective ?? null));
      if (candidateConflicts.length > 0) {
        conflicts.push(...candidateConflicts.map((header) => ({
          kind: 'field' as const, rowId: row.rowId, header,
          expected: expectedRow.values[header]?.effective ?? null,
          current: row.values[header]?.effective ?? null,
          requested: next.values[header]?.effective ?? null,
        })));
        continue;
      }
      Object.assign(row, next);
      Object.assign(expectedRow, nextExpected);
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
      let hasPriorValueChange = false;
      if (Object.prototype.hasOwnProperty.call(operation, 'measurement')) {
        const requestedMeasurement = operation.measurement ?? null;
        const currentMeasurement = row.calculation?.measurement ?? null;
        const expectedMeasurement = expectedRow.calculation?.measurement ?? null;
        if (!sameProcessingMeasurement(currentMeasurement, expectedMeasurement) &&
          !sameProcessingMeasurement(currentMeasurement, requestedMeasurement)) {
          conflicts.push({
            kind: 'measurement',
            rowId: row.rowId,
            expected: expectedMeasurement,
            current: currentMeasurement,
            requested: requestedMeasurement,
          });
        } else {
          setProcessingMeasurement(row, operation.measurement);
          setProcessingMeasurement(expectedRow, operation.measurement);
          if (operation.measurement === null) {
            clearProcessingDerivedProvenance(row);
            clearProcessingDerivedProvenance(expectedRow);
          }
        }
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
        if (currentValue === requestedValue && !hasPriorValueChange) {
          continue;
        }
        if (currentValue !== requestedValue) {
          row.values[change.header] = { ...row.values[change.header], effective: requestedValue };
          expectedRow.values[change.header] = { ...expectedRow.values[change.header], effective: requestedValue };
          hasPriorValueChange = true;
        }
        conflicts.push(...applyRowCalculation(row, expectedRow, headers, [change.header]));
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
      if (operation.binding) {
        const requested = {
          kind: 'processing' as const,
          parentRowId: operation.binding.parentRowId,
          cascadeDeletedBy: null,
        };
        stageBinding(row, expectedRow, requested, currentById, expectedById, conflicts);
      }
      if (operation.measurement !== undefined || operation.binding !== undefined) {
        const parentId = row.system?.kind === 'processing' ? row.system.parentRowId : null;
        const parent = parentId ? currentById.get(parentId) : undefined;
        const expectedParent = parentId ? expectedById.get(parentId) : undefined;
        conflicts.push(...applyProcessingRowCalculation(
          row,
          expectedRow,
          parent,
          expectedParent,
          headers,
          !(operation.changes ?? []).some((change) => change.header === '總數'),
        ));
      }
      const changedHeaders = operation.changes?.map((change) => change.header) ?? [];
      if (row.system?.kind === 'material' && changedHeaders.some((header) => header === '數量' || header === '長度')) {
        conflicts.push(...recalculateChildrenForParent(row, current, expectedById, currentById, headers));
      }
      continue;
    }
    if (operation.type === 'classify') {
      if (!expectedRow || expectedRow.system?.kind !== 'unassigned') {
        conflicts.push(relationConflict(row, expectedRow ?? row, operation.system));
        continue;
      }
      stageBinding(row, expectedRow, operation.system, currentById, expectedById, conflicts);
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
        if (row.system?.kind === 'material') {
          for (const child of current) {
            if (child.system?.kind !== 'processing' || child.system.parentRowId !== row.rowId || child.deleted) {
              continue;
            }
            const expectedChild = expectedById.get(child.rowId);
            if (!expectedChild || expectedChild.deleted || !sameOperationBusinessState(child, expectedChild, headers)) {
              conflicts.push({ kind: 'activity', rowId: child.rowId, reason: 'current-deleted' });
              continue;
            }
            child.deleted = true;
            expectedChild.deleted = true;
            child.system = { ...child.system, cascadeDeletedBy: row.rowId };
            if (expectedChild.system?.kind === 'processing') {
              expectedChild.system = { ...expectedChild.system, cascadeDeletedBy: row.rowId };
            }
          }
        }
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
    if (row.system?.kind === 'material') {
      for (const child of current) {
        if (child.system?.kind !== 'processing' || child.system.parentRowId !== row.rowId ||
          !child.deleted || child.system.cascadeDeletedBy !== row.rowId) {
          continue;
        }
        const expectedChild = expectedById.get(child.rowId);
        if (!expectedChild || !expectedChild.deleted || expectedChild.system?.cascadeDeletedBy !== row.rowId ||
          !sameOperationBusinessState(child, expectedChild, headers)) {
          conflicts.push({ kind: 'activity', rowId: child.rowId, reason: 'current-restored' });
          continue;
        }
        child.deleted = false;
        expectedChild.deleted = false;
        child.system = { ...child.system, cascadeDeletedBy: null };
        expectedChild.system = { ...expectedChild.system, cascadeDeletedBy: null };
      }
    }
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
  selectionEvidence?: readonly SteelCatalogSelectionEvidence[];
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
    ...(input.selectionEvidence ? { selectionEvidence: input.selectionEvidence } : {}),
  });
}
export type SteelReviewSaveResponse = z.infer<typeof steelReviewSaveResponseSchema>;
export type SteelReviewSourceFile = z.infer<typeof steelReviewSourceFileSchema>;
export type SteelReviewSourcesResponse = z.infer<typeof steelReviewSourcesResponseSchema>;
export type SteelReviewSourcePageCount = z.infer<typeof steelReviewSourcePageCountSchema>;
export type SteelReviewSourceQuery = z.infer<typeof steelReviewSourceQuerySchema>;
export type SteelReviewSourceBinaryQuery = z.infer<typeof steelReviewSourceBinaryQuerySchema>;
