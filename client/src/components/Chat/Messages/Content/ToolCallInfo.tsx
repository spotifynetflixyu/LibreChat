import { useState, useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tools } from 'librechat-data-provider';
import { UIResourceRenderer } from '@mcp-ui/client';
import type { TAttachment, UIResource } from 'librechat-data-provider';
import { useOptionalMessagesOperations } from '~/Providers';
import { useLocalize, useExpandCollapse } from '~/hooks';
import UIResourceCarousel from './UIResourceCarousel';
import { handleUIAction, cn } from '~/utils';
import { OutputRenderer } from './ToolOutput';

const parameterPreviewLength = 200;

function isSimpleObject(obj: unknown): obj is Record<string, string | number | boolean | null> {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return false;
  }
  const entries = Object.entries(obj);
  if (entries.length === 0 || entries.length > 8) {
    return false;
  }
  return entries.every(
    ([, v]) =>
      v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean',
  );
}

function KeyValueInput({ data }: { data: Record<string, string | number | boolean | null> }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-1.5">
          <span className="font-medium text-text-secondary">{key}</span>
          <span className="rounded bg-surface-tertiary px-1.5 py-0.5 text-text-primary">
            {String(value ?? 'null')}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatParamValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

function ParameterValue({ name, value }: { name: string; value: unknown }) {
  const localize = useLocalize();
  const [isExpanded, setIsExpanded] = useState(false);
  const content = formatParamValue(value);
  const canExpand = content.length > parameterPreviewLength;
  const actionLabel = localize(isExpanded ? 'com_ui_show_less' : 'com_ui_show_more');
  const visibleContent =
    canExpand && !isExpanded ? `${content.slice(0, parameterPreviewLength)}…` : content;

  return (
    <>
      <span
        className="mt-1 block max-h-[300px] max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-surface-tertiary px-1.5 py-0.5 font-mono text-text-primary"
        aria-label={`${name} parameter value`}
      >
        {visibleContent}
      </span>
      {canExpand && (
        <button
          type="button"
          className="mt-1 text-xs text-text-secondary underline decoration-border-medium underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy"
          aria-expanded={isExpanded}
          aria-label={`${actionLabel} ${name}`}
          onClick={() => setIsExpanded((current) => !current)}
        >
          {actionLabel}
        </button>
      )}
    </>
  );
}

function ComplexInput({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="grid min-w-0 gap-2 text-xs">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="min-w-0">
          <span className="block font-medium text-text-secondary">{key}</span>
          <ParameterValue name={key} value={value} />
        </div>
      ))}
    </div>
  );
}

function InputRenderer({ input }: { input: string }) {
  if (!input || input.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(input);
    if (isSimpleObject(parsed)) {
      return <KeyValueInput data={parsed} />;
    }
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return <ComplexInput data={parsed as Record<string, unknown>} />;
    }
    // Valid JSON but not a plain object (array, string, number, boolean) — render formatted
    return (
      <pre className="whitespace-pre-wrap text-xs text-text-primary">
        {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
      </pre>
    );
  } catch {
    // Not JSON — render as plain text
    return <pre className="whitespace-pre-wrap text-xs text-text-primary">{input}</pre>;
  }
}

export default function ToolCallInfo({
  input,
  output,
  attachments,
  resultUnavailable = false,
}: {
  input: string;
  output?: string | null;
  attachments?: TAttachment[];
  resultUnavailable?: boolean;
}) {
  const localize = useLocalize();
  const { ask } = useOptionalMessagesOperations();
  const [showParams, setShowParams] = useState(false);
  const { style: paramsExpandStyle, ref: paramsExpandRef } = useExpandCollapse(showParams);

  const hasParams = useMemo(() => {
    if (!input || input.trim().length === 0) {
      return false;
    }
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed === 'object' && parsed !== null) {
        return Object.keys(parsed).length > 0;
      }
    } catch {
      // Not JSON
    }
    return input.trim().length > 0;
  }, [input]);

  const uiResources: UIResource[] =
    attachments
      ?.filter((attachment) => attachment.type === Tools.ui_resources)
      .flatMap((attachment) => {
        return attachment[Tools.ui_resources] as UIResource[];
      }) ?? [];

  return (
    <div className="w-full px-3 py-3.5">
      {output && <OutputRenderer text={output} />}
      {resultUnavailable && (
        <p className="text-xs text-text-secondary">{localize('com_ui_tool_result_not_saved')}</p>
      )}
      {(output || resultUnavailable) && hasParams && (
        <div className="my-2 border-t border-border-light" />
      )}
      {hasParams && (
        <>
          <button
            type="button"
            className={cn(
              'inline-flex items-center gap-1 text-xs text-text-secondary',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-heavy',
            )}
            onClick={() => setShowParams((prev) => !prev)}
            aria-expanded={showParams}
          >
            <span>{localize('com_ui_parameters')}</span>
            <ChevronDown
              className={cn(
                'size-3 shrink-0 transition-transform duration-200 ease-out',
                showParams && 'rotate-180',
              )}
              aria-hidden="true"
            />
          </button>
          <div style={paramsExpandStyle}>
            <div className="overflow-hidden pt-1" ref={paramsExpandRef}>
              <InputRenderer input={input} />
            </div>
          </div>
        </>
      )}
      {uiResources.length > 0 && (
        <>
          {(hasParams || output) && <div className="my-2 border-t border-border-light" />}
          {uiResources.length > 1 && <UIResourceCarousel uiResources={uiResources} />}
          {uiResources.length === 1 && (
            <UIResourceRenderer
              resource={uiResources[0]}
              onUIAction={async (result) => handleUIAction(result, ask)}
              htmlProps={{
                autoResizeIframe: { width: true, height: true },
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
