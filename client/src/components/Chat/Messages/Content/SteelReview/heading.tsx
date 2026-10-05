import React, { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { Tag } from '@librechat/client';
import type { SteelMarkdownVersion, TMessage } from 'librechat-data-provider';
import { useGetSteelMarkdownVersionsQuery } from '~/data-provider';
import { useMessageContext } from '~/Providers';
import { useLocalize } from '~/hooks';

export const SteelVersionsContext = createContext<ReadonlyMap<string, SteelMarkdownVersion>>(new Map());
type SteelMarkdownOwner = Pick<SteelMarkdownVersion, 'outputId' | 'title'>;
const SteelVersionOwnersContext = createContext<ReadonlyMap<string, SteelMarkdownOwner>>(new Map());

const steelMarkdownKinds: readonly SteelMarkdownVersion['kind'][] = [
  'ocr_result',
  'system_order',
  'customer_data',
];

function isSteelMarkdownOwner(value: unknown): value is SteelMarkdownOwner {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const outputId = Reflect.get(value, 'outputId');
  const title = Reflect.get(value, 'title');
  return (
    typeof outputId === 'string' &&
    outputId.length > 0 &&
    typeof title === 'string' &&
    title.length > 0
  );
}

function getSteelMarkdownOwner(
  message: TMessage,
  kind: SteelMarkdownVersion['kind'],
): SteelMarkdownOwner | undefined {
  const owners = message.metadata?.steelMarkdownOwners;
  if (typeof owners !== 'object' || owners === null || Array.isArray(owners)) {
    return undefined;
  }

  const owner = Reflect.get(owners, kind);
  return isSteelMarkdownOwner(owner) ? owner : undefined;
}

function steelVersionOwnerKey(messageId: string, kind: SteelMarkdownVersion['kind']): string {
  return `${messageId}:${kind}`;
}

export function SteelVersionsProvider({
  conversationId,
  messages,
  isSubmitting,
  children,
}: {
  conversationId?: string | null;
  messages?: readonly TMessage[] | null;
  isSubmitting: boolean;
  children: React.ReactNode;
}) {
  const hasManagedHeading = useMemo(
    () =>
      messages?.some(
        (message) =>
          message.isCreatedByUser !== true &&
          /^ {0,3}##[\t ]+(?:ocr_result|system_order|customer_data)(?:[\t ｜]|$)/m.test(
            message.text ?? '',
          ),
      ) === true,
    [messages],
  );
  const enabled = Boolean(conversationId) && hasManagedHeading;
  const { data, refetch } = useGetSteelMarkdownVersionsQuery(conversationId ?? '', enabled);
  const submitting = useRef(isSubmitting);
  useEffect(() => {
    const completed = submitting.current && !isSubmitting;
    submitting.current = isSubmitting;
    if (completed && enabled) void refetch();
  }, [enabled, isSubmitting, refetch]);

  const owners = useMemo(() => {
    const next = new Map<string, SteelMarkdownOwner>();
    for (const message of messages ?? []) {
      for (const kind of steelMarkdownKinds) {
        const owner = getSteelMarkdownOwner(message, kind);
        if (owner != null) {
          next.set(steelVersionOwnerKey(message.messageId, kind), owner);
        }
      }
    }
    return next;
  }, [messages]);

  const versions = useMemo(() => new Map((data?.versions ?? []).map((version) => [
    JSON.stringify([version.messageId, version.kind, version.title, version.outputId]), version,
  ])), [data?.versions]);

  return (
    <SteelVersionsContext.Provider value={versions}>
      <SteelVersionOwnersContext.Provider value={owners}>
        {children}
      </SteelVersionOwnersContext.Provider>
    </SteelVersionsContext.Provider>
  );
}

function headingText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(headingText).join('');
  return React.isValidElement<{ children?: React.ReactNode }>(node)
    ? headingText(node.props.children)
    : '';
}

export function SteelHeading({
  children,
  node: _node,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { node?: object }) {
  const localize = useLocalize();
  const { messageId } = useMessageContext();
  const versions = useContext(SteelVersionsContext);
  const owners = useContext(SteelVersionOwnersContext);
  const title = headingText(children);
  const kind = steelMarkdownKinds.find((candidate) => owners.get(steelVersionOwnerKey(messageId, candidate))?.title === title);
  const owner = kind ? owners.get(steelVersionOwnerKey(messageId, kind)) : undefined;
  const version = owner ? versions.get(JSON.stringify([messageId, kind, title, owner.outputId])) : undefined;
  const hasSaveCount = version?.kind !== 'customer_data' && version != null && version.saves > 0;
  const label =
    version == null
      ? undefined
      : `${localize(
          version.latest
            ? 'com_ui_steel_review_latest_version'
            : 'com_ui_steel_review_previous_version',
        )}${hasSaveCount ? ` v${version.saves + 1}` : ''}`;

  return (
    <h2 {...props} data-markdown-title={title}>
      {children}
      {label && (
        <Tag
          className="ml-2 align-middle"
          label={label}
          variant={version?.latest ? 'success' : 'neutral'}
        />
      )}
    </h2>
  );
}
