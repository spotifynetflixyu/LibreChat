import { ContentTypes, steelQuotationMessagePublicationSchema } from 'librechat-data-provider';
import type {
  SteelQuotationMessagePublication,
  SteelQuotationMessageUpdate,
  SteelReviewSavedSnapshot,
  TMessage,
  TMessageContentParts,
} from 'librechat-data-provider';

type SteelQuotationOwner = {
  effectiveVersion?: number;
};

type SteelQuotationMetadata = SteelQuotationMessagePublication & {
  ownerUpdated?: SteelQuotationOwner;
};

type MessageMetadata = {
  steelQuotation?: SteelQuotationMetadata;
  [key: string]: unknown;
};

type MetadataRecord = Record<string, unknown>;

export type SteelQuotationMessageUpdateSource = SteelQuotationMessageUpdate['update'];

const getMetadata = (message: TMessage): MessageMetadata | undefined => {
  const metadata = message.metadata;
  if (metadata == null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return undefined;
  }
  return metadata as MessageMetadata;
};

const asRecord = (value: unknown): MetadataRecord | undefined =>
  value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as MetadataRecord)
    : undefined;

const omitSystemOrder = (namespace: MetadataRecord | undefined): MetadataRecord | undefined => {
  if (!namespace) {
    return undefined;
  }
  const result = { ...namespace };
  delete result.system_order;
  return result;
};

const getSteelQuotationMetadata = (message: TMessage): SteelQuotationMetadata | undefined =>
  getMetadata(message)?.steelQuotation;

const getCanonicalOwner = (message: TMessage): MetadataRecord | undefined => {
  const metadata = getMetadata(message);
  const reviewOwner = asRecord(asRecord(metadata?.steelReview)?.system_order);
  if (reviewOwner) {
    return reviewOwner;
  }
  return asRecord(asRecord(metadata?.steelMarkdownOwners)?.system_order);
};

const getOwnerOutputId = (message: TMessage): string | undefined => {
  const ownerOutputId = getCanonicalOwner(message)?.outputId;
  return typeof ownerOutputId === 'string'
    ? ownerOutputId
    : getSteelQuotationMetadata(message)?.outputId;
};

const getEffectiveVersion = (message: TMessage): number => {
  const version =
    getCanonicalOwner(message)?.effectiveVersion ??
    getSteelQuotationMetadata(message)?.ownerUpdated?.effectiveVersion;
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : 1;
};

const samePublicationIdentity = (
  current: SteelQuotationMetadata | undefined,
  publication: SteelQuotationMessagePublication,
): boolean =>
  current != null &&
  current.runId === publication.runId &&
  current.outputId === publication.outputId &&
  current.sourceMessageId === publication.sourceMessageId &&
  current.admissionSequence === publication.admissionSequence &&
  current.receiptSha256 === publication.receiptSha256;

const getPartText = (part: TMessageContentParts | undefined): string | undefined => {
  if (part == null || part.type !== ContentTypes.TEXT) {
    return undefined;
  }
  const text = part.text;
  if (typeof text === 'string') {
    return text;
  }
  if (
    text != null &&
    typeof text === 'object' &&
    'value' in text &&
    typeof text.value === 'string'
  ) {
    return text.value;
  }
  return undefined;
};

const appendRenderedText = (current: string, next: string): string => {
  if (
    current.length > 0 &&
    next.length > 0 &&
    current[current.length - 1] !== ' ' &&
    next[0] !== ' '
  ) {
    return `${current} ${next}`;
  }
  return `${current}${next}`;
};

const renderContentText = (content: TMessage['content']): string | undefined => {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const text = content.reduce((result, part) => {
    const partText = getPartText(part);
    return partText == null ? result : appendRenderedText(result, partText);
  }, '');
  return text.length > 0 ? text : undefined;
};

const copyContent = (content: TMessage['content']): TMessageContentParts[] =>
  Array.isArray(content) ? content.map((part) => ({ ...part })) : [];

const mergeAtIndex = (
  content: TMessageContentParts[],
  index: number,
  part: TMessageContentParts | undefined,
): TMessageContentParts[] => {
  if (part == null || index < 0) {
    return content;
  }
  const next = [...content];
  next[index] = { ...part };
  return next;
};

const mergeMessageMetadata = (
  current: TMessage,
  incoming: TMessage,
  publication: SteelQuotationMessagePublication,
  update: SteelQuotationMessageUpdateSource,
): TMessage['metadata'] => {
  const currentMetadata = getMetadata(current) ?? {};
  const incomingMetadata = getMetadata(incoming) ?? {};
  const currentSteel = currentMetadata.steelQuotation;
  const incomingSteel = incomingMetadata.steelQuotation;
  const samePublication =
    currentSteel?.outputId === publication.outputId &&
    currentSteel?.receiptSha256 === publication.receiptSha256;
  const ownerUpdated =
    update === 'order'
      ? (incomingSteel?.ownerUpdated ?? (samePublication ? currentSteel?.ownerUpdated : undefined))
      : (currentSteel?.ownerUpdated ?? incomingSteel?.ownerUpdated);
  const summaryReceiptSha256 =
    incomingSteel?.summaryReceiptSha256 ?? publication.summaryReceiptSha256;
  const steelQuotation: SteelQuotationMetadata = {
    ...incomingSteel,
    ...publication,
    ...(currentSteel && update !== 'order' ? currentSteel : {}),
    ...(update === 'summary' && currentSteel?.receiptSha256
      ? { receiptSha256: currentSteel.receiptSha256 }
      : {}),
    ...(update === 'summary' && summaryReceiptSha256 ? { summaryReceiptSha256 } : {}),
    ...(ownerUpdated ? { ownerUpdated } : {}),
  };
  const currentReview = asRecord(currentMetadata.steelReview);
  const incomingReview = asRecord(incomingMetadata.steelReview);
  const currentMarkdownOwners = asRecord(currentMetadata.steelMarkdownOwners);
  const incomingMarkdownOwners = asRecord(incomingMetadata.steelMarkdownOwners);
  const currentOwnerRecord = asRecord(
    currentReview?.system_order ?? currentMarkdownOwners?.system_order,
  );
  const incomingOwnerRecord = asRecord(
    incomingReview?.system_order ?? incomingMarkdownOwners?.system_order,
  );
  const currentOwnerIsHuman =
    currentOwnerRecord != null &&
    getEffectiveVersion(current) > 1 &&
    (update === 'summary' || getEffectiveVersion(current) >= getEffectiveVersion(incoming)) &&
    getOwnerOutputId(current) === publication.outputId &&
    currentSteel?.receiptSha256 === publication.receiptSha256;
  const mergedOwner = currentOwnerIsHuman ? currentOwnerRecord : incomingOwnerRecord;
  const currentReviewBase =
    update === 'order' && currentSteel != null && !samePublication
      ? omitSystemOrder(currentReview)
      : currentReview;
  const currentMarkdownOwnersBase =
    update === 'order' && currentSteel != null && !samePublication
      ? omitSystemOrder(currentMarkdownOwners)
      : currentMarkdownOwners;
  const metadata: MessageMetadata = {
    ...currentMetadata,
    ...incomingMetadata,
  };
  if (currentReview || incomingReview || mergedOwner) {
    metadata.steelReview = {
      ...currentReviewBase,
      ...incomingReview,
      ...(mergedOwner ? { system_order: mergedOwner } : {}),
    };
  }
  if (currentMarkdownOwners || incomingMarkdownOwners || mergedOwner) {
    metadata.steelMarkdownOwners = {
      ...currentMarkdownOwnersBase,
      ...incomingMarkdownOwners,
      ...(mergedOwner ? { system_order: mergedOwner } : {}),
    };
  }
  return {
    ...metadata,
    steelQuotation,
  };
};

const mergeMainOwnerNamespace = (
  currentNamespace: MetadataRecord | undefined,
  incomingNamespace: MetadataRecord | undefined,
  current: TMessage,
  incoming: TMessage,
): MetadataRecord | undefined => {
  if (!currentNamespace && !incomingNamespace) {
    return undefined;
  }
  const currentOwner = asRecord(currentNamespace?.system_order);
  const incomingOwner = asRecord(incomingNamespace?.system_order);
  const currentSteel = getSteelQuotationMetadata(current);
  const incomingSteel = getSteelQuotationMetadata(incoming);
  const currentOutputId = currentOwner?.outputId;
  const incomingOutputId = incomingOwner?.outputId;
  const samePublication =
    currentSteel?.outputId === incomingSteel?.outputId &&
    currentSteel?.receiptSha256 === incomingSteel?.receiptSha256;
  const currentNamespaceBase =
    incomingSteel != null && !samePublication
      ? omitSystemOrder(currentNamespace)
      : currentNamespace;
  const preserveCurrentOwner =
    currentOwner != null &&
    (incomingOwner == null ||
      (samePublication &&
        currentOutputId === incomingOutputId &&
        getEffectiveVersion(current) > getEffectiveVersion(incoming)));
  let owner: MetadataRecord | undefined;
  if (preserveCurrentOwner) {
    owner = currentOwner;
  } else if (incomingOwner) {
    owner = incomingOwner;
  }
  return {
    ...incomingNamespace,
    ...currentNamespaceBase,
    ...(owner ? { system_order: owner } : {}),
  };
};

/**
 * Applies a committed quotation event to one already-owned message. The
 * caller must reject foreign message/conversation identities before calling
 * this helper. `order` replaces only the table partition; `summary` replaces
 * only the summary/footer partitions.
 */
export function mergeSteelQuotationMessageUpdate(
  current: TMessage,
  update: SteelQuotationMessageUpdate,
): TMessage {
  const { message: incoming, publication } = update;
  const currentSteel = getSteelQuotationMetadata(current);
  const currentVersion = getEffectiveVersion(current);
  const currentOutputId = getOwnerOutputId(current) ?? currentSteel?.outputId;
  const incomingVersion = getEffectiveVersion(incoming);

  if (
    update.update === 'summary' &&
    !samePublicationIdentity(currentSteel, publication)
  ) {
    return current;
  }

  if (
    update.update === 'order' &&
    currentSteel?.receiptSha256 === publication.receiptSha256 &&
    currentSteel.outputId === publication.outputId &&
    incomingVersion <= currentVersion
  ) {
    return current;
  }

  if (
    update.update === 'order' &&
    currentSteel?.admissionSequence != null &&
    (publication.admissionSequence < currentSteel.admissionSequence ||
      (publication.admissionSequence === currentSteel.admissionSequence &&
        (currentSteel.receiptSha256 !== publication.receiptSha256 ||
          currentSteel.outputId !== publication.outputId)))
  ) {
    return current;
  }

  if (
    update.update === 'order' &&
    currentVersion > incomingVersion &&
    currentOutputId === publication.outputId &&
    currentSteel?.receiptSha256 === publication.receiptSha256
  ) {
    return current;
  }

  const currentContent = copyContent(current.content);
  const incomingContent = copyContent(incoming.content);
  if (
    update.update === 'summary' &&
    currentSteel?.receiptSha256 === publication.receiptSha256 &&
    currentSteel.outputId === publication.outputId &&
    currentSteel.summaryReceiptSha256 === publication.summaryReceiptSha256 &&
    JSON.stringify(currentContent[publication.summaryContentIndex]) ===
      JSON.stringify(incomingContent[publication.summaryContentIndex]) &&
    JSON.stringify(currentContent[publication.footerContentIndex]) ===
      JSON.stringify(incomingContent[publication.footerContentIndex])
  ) {
    return current;
  }
  let content =
    update.update === 'order' && samePublicationIdentity(currentSteel, publication) && currentContent.length > 0
      ? currentContent : incomingContent;

  if (update.update === 'order') {
    content = mergeAtIndex(
      content,
      publication.tableContentIndex,
      incomingContent[publication.tableContentIndex],
    );
  } else {
    const tablePart = currentContent[publication.tableContentIndex];
    if (tablePart != null) {
      content = mergeAtIndex(content, publication.tableContentIndex, tablePart);
    }
    const summaryPart = incomingContent[publication.summaryContentIndex];
    const footerPart = incomingContent[publication.footerContentIndex];
    content = mergeAtIndex(content, publication.summaryContentIndex, summaryPart);
    content = mergeAtIndex(content, publication.footerContentIndex, footerPart);
    for (let index = 0; index < currentContent.length; index++) {
      if (content[index] == null && currentContent[index] != null) {
        content = mergeAtIndex(content, index, currentContent[index]);
      }
    }
  }

  const renderedText = renderContentText(content);
  return {
    ...current,
    ...incoming,
    text: renderedText ?? incoming.text ?? current.text,
    ...(content.length > 0 ? { content } : {}),
    metadata: mergeMessageMetadata(current, incoming, publication, update.update),
  };
}
/**
 * Protects the committed table while a normal delta, terminal snapshot, or
 * error snapshot updates the main response partitions.
 */
export function mergeSteelQuotationMainSnapshot(
  current: TMessage | undefined,
  incoming: TMessage,
): TMessage {
  const currentSteel = current == null ? undefined : getSteelQuotationMetadata(current);
  if (current == null || currentSteel == null) {
    return incoming;
  }

  const currentContent = copyContent(current.content);
  const incomingContent = copyContent(incoming.content);
  const incomingSteel = getSteelQuotationMetadata(incoming);
  if (incomingSteel && !samePublicationIdentity(currentSteel, incomingSteel)) {
    if (incomingSteel.admissionSequence <= currentSteel.admissionSequence ||
      !getPartText(incomingContent[incomingSteel.tableContentIndex])?.trim()) {
      return current;
    }
    return incoming;
  }
  let content = incomingContent;
  const tablePart = currentContent[currentSteel.tableContentIndex];
  if (tablePart != null) {
    content = mergeAtIndex(content, currentSteel.tableContentIndex, tablePart);
  }
  const footerPart = currentContent[currentSteel.footerContentIndex];
  if (footerPart != null) {
    content = mergeAtIndex(content, currentSteel.footerContentIndex, footerPart);
  }
  for (let index = 0; index < currentContent.length; index++) {
    if (content[index] == null && currentContent[index] != null) {
      content = mergeAtIndex(content, index, currentContent[index]);
    }
  }
  const renderedText = renderContentText(content);
  const currentMetadata = getMetadata(current) ?? {};
  const incomingMetadata = getMetadata(incoming) ?? {};
  const mergedReview = mergeMainOwnerNamespace(
    asRecord(currentMetadata.steelReview),
    asRecord(incomingMetadata.steelReview),
    current,
    incoming,
  );
  const mergedMarkdownOwners = mergeMainOwnerNamespace(
    asRecord(currentMetadata.steelMarkdownOwners),
    asRecord(incomingMetadata.steelMarkdownOwners),
    current,
    incoming,
  );
  return {
    ...incoming,
    text: renderedText ?? incoming.text ?? current.text,
    ...(content.length > 0 ? { content } : {}),
    metadata: {
      ...currentMetadata,
      ...incomingMetadata,
      ...(mergedReview ? { steelReview: mergedReview } : {}),
      ...(mergedMarkdownOwners ? { steelMarkdownOwners: mergedMarkdownOwners } : {}),
      steelQuotation: {
        ...incomingSteel,
        ...currentSteel,
        ...(!currentSteel.summaryReceiptSha256 && incomingSteel?.summaryReceiptSha256
          ? { summaryReceiptSha256: incomingSteel.summaryReceiptSha256 }
          : {}),
        tableContentIndex: currentSteel.tableContentIndex,
        summaryContentIndex: currentSteel.summaryContentIndex,
        footerContentIndex: currentSteel.footerContentIndex,
        ownerUpdated: currentSteel.ownerUpdated ?? incomingSteel?.ownerUpdated,
      },
    },
  };
}

export function applySteelQuotationReviewOwner(
  message: TMessage,
  snapshot: Pick<
    SteelReviewSavedSnapshot,
    'digest' | 'outputId' | 'ownerUpdated' | 'messageTextParts'
  >,
): TMessage {
  if (!snapshot.ownerUpdated) {
    return message;
  }
  const metadata = getMetadata(message);
  const currentSteel = getSteelQuotationMetadata(message);
  if (!metadata || !currentSteel) {
    return message;
  }
  const effectiveVersion =
    snapshot.ownerUpdated.effectiveVersion ??
    Number.parseInt(snapshot.ownerUpdated.revision.replace(/^v/u, ''), 10);
  const ownerUpdated: SteelQuotationOwner = {
    ...currentSteel.ownerUpdated,
    ...(Number.isInteger(effectiveVersion) && effectiveVersion > 0 ? { effectiveVersion } : {}),
  };
  return {
    ...message,
    metadata: {
      ...metadata,
      steelQuotation: {
        ...currentSteel,
        ownerUpdated,
      },
    },
  };
}

export function isSteelQuotationMessageUpdate(
  value: unknown,
): value is SteelQuotationMessageUpdate {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<SteelQuotationMessageUpdate>;
  const publication = steelQuotationMessagePublicationSchema.safeParse(candidate.publication);
  return (
    (candidate.update === 'order' || candidate.update === 'summary') &&
    candidate.message != null &&
    typeof candidate.message === 'object' &&
    publication.success
  );
}
