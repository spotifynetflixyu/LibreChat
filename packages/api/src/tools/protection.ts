import { ACTION_METADATA_FILTER_FIELDS, hasActivePiiFields } from 'librechat-data-provider';
import type { FiltersConfig } from 'librechat-data-provider';
import type {
  AssistantActionContentInput,
  ToolArgumentContentInput,
} from '../protection/adapters/submissions';
import type {
  CanonicalFileInspectionUser,
  GetCanonicalFilesForInspection,
} from '../protection/files';
import type { UninspectableNestedContentResponse } from '../protection/adapters/nested';
import {
  getContentTraversalFragments,
  isContentTraversalLimitError,
  isContentTraversalProtected,
} from '../protection/adapters/nested';
import {
  contentFilterModelBoundBlockResponse,
  ContentFilterError,
  type ContentFilterBlockResponse,
} from '../middleware/contentFilter';
import {
  extractToolArgumentContent,
  extractAssistantActionContent,
} from '../protection/adapters/submissions';
import { inspectContent, inspectContentWithTraversal } from '../protection/runtime';
import { resolveCanonicalFileReferences } from '../protection/files';

export type RequiredActionContentFailureBody =
  | ContentFilterBlockResponse
  | UninspectableNestedContentResponse;

export interface RequiredActionContentFailure {
  readonly code: RequiredActionContentFailureBody['error'];
  readonly body: RequiredActionContentFailureBody;
}

export class RequiredActionContentPolicyError extends Error {
  public readonly code: RequiredActionContentFailure['code'];
  public readonly statusCode = 400;
  public readonly body: RequiredActionContentFailureBody;

  constructor(failure: RequiredActionContentFailure) {
    super(failure.body.message);
    this.name = 'RequiredActionContentPolicyError';
    this.code = failure.code;
    this.body = failure.body;
    Object.setPrototypeOf(this, RequiredActionContentPolicyError.prototype);
  }
}

/** Maps policy errors raised by a tool into the stable model-bound response. */
export function getRequiredActionPolicyBody(
  error: unknown,
): RequiredActionContentFailureBody | null {
  if (error instanceof RequiredActionContentPolicyError) {
    return error.body;
  }
  if (error instanceof ContentFilterError) {
    return contentFilterModelBoundBlockResponse(error.body);
  }
  return null;
}

const requiredActionFields = ['name', 'arguments', 'output'] as const;
type RequiredActionField = (typeof requiredActionFields)[number];

/** Whether a required-action load needs the pre-execution policy pass. */
export function hasRequiredActionContentPolicy(filters: FiltersConfig | undefined): boolean {
  return (
    hasActivePiiFields(filters?.toolArguments?.pii, ['name', 'arguments']) ||
    hasActivePiiFields(filters?.actionMetadata?.pii, ACTION_METADATA_FILTER_FIELDS)
  );
}

function inspectRequiredActionField(
  filters: FiltersConfig | undefined,
  field: RequiredActionField,
  value: unknown,
): RequiredActionContentFailure | null {
  if (!hasActivePiiFields(filters?.toolArguments?.pii, [field])) {
    return null;
  }

  try {
    const finding = inspectContent(extractToolArgumentContent({ [field]: value }), { filters });
    return finding == null
      ? null
      : { code: 'content_filter_block', body: contentFilterModelBoundBlockResponse(finding) };
  } catch (error) {
    if (!isContentTraversalLimitError(error)) {
      throw error;
    }

    const finding = inspectContent(getContentTraversalFragments(error), { filters });
    if (finding != null) {
      return { code: 'content_filter_block', body: contentFilterModelBoundBlockResponse(finding) };
    }
    if (!isContentTraversalProtected({ error, filters })) {
      return null;
    }
    return { code: error.code, body: error.body };
  }
}

/** Inspects only the selected required-action fields before any side effect. */
export function inspectRequiredActionContent(
  filters: FiltersConfig | undefined,
  input: ToolArgumentContentInput,
  fields: readonly RequiredActionField[] = requiredActionFields,
): RequiredActionContentFailure | null {
  for (const field of fields) {
    const failure = inspectRequiredActionField(filters, field, input[field]);
    if (failure != null) {
      return failure;
    }
  }
  return null;
}

export interface RequiredActionInvocation {
  readonly tool: string;
  readonly toolInput: unknown;
}

/** Finds the first required-action name/argument policy failure before side effects. */
export function findRequiredActionContentFailure(
  filters: FiltersConfig | undefined,
  actions: readonly RequiredActionInvocation[],
): RequiredActionContentFailure | null {
  for (const action of actions) {
    const failure = inspectRequiredActionContent(
      filters,
      { name: action.tool, arguments: action.toolInput },
      ['name', 'arguments'],
    );
    if (failure != null) {
      return failure;
    }
  }
  return null;
}

export interface RequiredActionOutputInspection {
  readonly output: unknown;
  readonly failure: RequiredActionContentFailure | null;
}

/** Replaces filtered tool output with the safe model-bound policy body. */
export function inspectAndSanitizeRequiredActionOutput(
  filters: FiltersConfig | undefined,
  output: unknown,
): RequiredActionOutputInspection {
  const failure = inspectRequiredActionContent(filters, { output }, ['output']);
  return {
    output: failure == null ? output : JSON.stringify(failure.body),
    failure,
  };
}

/** Inspects decrypted Assistant action metadata before domain parsing or execution. */
export function inspectRequiredActionMetadata(
  filters: FiltersConfig | undefined,
  metadata: AssistantActionContentInput['metadata'],
): RequiredActionContentFailure | null {
  if (!hasActivePiiFields(filters?.actionMetadata?.pii, ACTION_METADATA_FILTER_FIELDS)) {
    return null;
  }

  const { finding, traversalError } = inspectContentWithTraversal(
    () => extractAssistantActionContent({ metadata }),
    { filters },
  );
  if (finding != null) {
    return { code: 'content_filter_block', body: contentFilterModelBoundBlockResponse(finding) };
  }
  if (traversalError != null) {
    return { code: traversalError.code, body: traversalError.body };
  }
  return null;
}

export interface RequiredActionMetadataRecord {
  readonly metadata?: AssistantActionContentInput['metadata'];
}

export interface InspectRequiredActionMetadataSetParams {
  readonly filters: FiltersConfig | undefined;
  readonly actions: readonly RequiredActionMetadataRecord[];
  readonly decryptMetadata?: (
    metadata: AssistantActionContentInput['metadata'],
  ) => Promise<AssistantActionContentInput['metadata']>;
}

/** Checks persisted action metadata before domain parsing and optional decryption. */
export async function findRequiredActionMetadataFailure({
  filters,
  actions,
  decryptMetadata,
}: InspectRequiredActionMetadataSetParams): Promise<RequiredActionContentFailure | null> {
  const decryptableFields = ACTION_METADATA_FILTER_FIELDS.filter(
    (field) => !['raw_spec', 'domain', 'privacy_policy_url'].includes(field),
  );
  const decryptRequired = hasActivePiiFields(
    filters?.actionMetadata?.pii,
    decryptableFields,
  );
  for (const action of actions) {
    const rawSpecFailure = inspectRequiredActionContent(
      filters,
      { arguments: action.metadata?.raw_spec },
      ['arguments'],
    );
    if (rawSpecFailure != null) {
      return rawSpecFailure;
    }
    let metadata = action.metadata;
    let failure = inspectRequiredActionMetadata(filters, metadata);
    if (failure != null) {
      return failure;
    }
    if (decryptRequired && decryptMetadata != null) {
      metadata = await decryptMetadata(action.metadata);
      failure = inspectRequiredActionMetadata(filters, metadata);
      if (failure != null) {
        return failure;
      }
    }
  }
  return null;
}

export interface HistoricalToolResourceInspectionParams {
  readonly filters: FiltersConfig | undefined;
  readonly user?: CanonicalFileInspectionUser;
  readonly toolResources?: Record<string, { readonly file_ids?: readonly string[] }> | null;
  readonly resourceNames?: readonly ('execute_code' | 'file_search')[];
  readonly getFiles: GetCanonicalFilesForInspection;
}

/** Fails closed for opaque historical file IDs before a tool primes them. */
export async function inspectHistoricalToolResources({
  filters,
  user,
  toolResources,
  resourceNames = ['execute_code', 'file_search'],
  getFiles,
}: HistoricalToolResourceInspectionParams): Promise<void> {
  for (const resourceName of resourceNames) {
    const fileIds = toolResources?.[resourceName]?.file_ids;
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      continue;
    }
    await resolveCanonicalFileReferences({
      input: { file_ids: fileIds },
      filters,
      user,
      getFiles,
    });
  }
}

function assertToolOutputFragmentsAllowed(
  filters: FiltersConfig | undefined,
  fragments: ReturnType<typeof extractToolArgumentContent>,
): void {
  const finding = inspectContent(fragments, { filters });
  if (finding != null) {
    throw new ContentFilterError(finding);
  }
}

/** Enforces direct-call tool output before persistence or HTTP disclosure. */
export function assertDirectToolOutputAllowed(
  filters: FiltersConfig | undefined,
  toolId: string,
  output: unknown,
): void {
  if (!hasActivePiiFields(filters?.toolArguments?.pii, ['output'])) {
    return;
  }
  try {
    assertToolOutputFragmentsAllowed(filters, extractToolArgumentContent({ name: toolId, output }));
  } catch (error) {
    if (!isContentTraversalLimitError(error)) {
      throw error;
    }
    assertToolOutputFragmentsAllowed(filters, getContentTraversalFragments(error));
    if (isContentTraversalProtected({ error, filters })) {
      throw error;
    }
  }
}
