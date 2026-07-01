import { memo, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import type { SteelNativeActivityEvent, SteelNativeSavedCounts } from '~/store/steel';
import { steelNativeActivityByMessageId } from '~/store/steel';
import useLocalize from '~/hooks/useLocalize';

type SteelActivityProps = {
  messageId: string;
  isCreatedByUser?: boolean;
};

const ocrSavedCountKeys = new Set(['ocr_extract']);
const paddleOcrSavedCountKeys = new Set(['paddleocr_preflight']);
const workbookSavedCountKeys = new Set([
  'calculation_fact',
  'customer_fact',
  'price_evidence',
  'working_order_row',
]);

function getSavedCountTotal(event: SteelNativeActivityEvent): number {
  return Object.values(event.savedCounts ?? {}).reduce((total, count) => total + count, 0);
}

function getSavedCountForKeys(savedCounts: SteelNativeSavedCounts | undefined, keys: Set<string>) {
  if (!savedCounts) {
    return 0;
  }

  return Object.entries(savedCounts).reduce((total, [key, count]) => {
    if (!keys.has(key) || !Number.isFinite(count) || count <= 0) {
      return total;
    }

    return total + count;
  }, 0);
}

function getActivityLabel(event: SteelNativeActivityEvent, localize: ReturnType<typeof useLocalize>) {
  if (event.source === 'paddleocr_preflight') {
    if (event.type === 'memory_saved') {
      return localize('com_ui_steel_activity_paddleocr_saved');
    }

    if (event.parseStatus === 'saved') {
      return localize('com_ui_steel_activity_paddleocr_saved');
    }

    if (event.parseStatus === 'partial') {
      return localize('com_ui_steel_activity_paddleocr_partial');
    }

    if (event.parseStatus === 'skipped') {
      return localize('com_ui_steel_activity_paddleocr_skipped');
    }
  }

  if (event.type === 'memory_saved') {
    return localize('com_ui_steel_activity_state_saved');
  }

  if (event.parseStatus === 'partial') {
    return localize('com_ui_steel_activity_parse_partial');
  }

  if (event.parseStatus === 'skipped') {
    return localize('com_ui_steel_activity_parse_skipped');
  }

  return localize('com_ui_steel_activity_parse_saved');
}

function getSavedCountText(
  event: SteelNativeActivityEvent,
  localize: ReturnType<typeof useLocalize>,
) {
  const ocrCount = getSavedCountForKeys(event.savedCounts, ocrSavedCountKeys);
  const paddleOcrCount = getSavedCountForKeys(event.savedCounts, paddleOcrSavedCountKeys);
  const workbookCount = getSavedCountForKeys(event.savedCounts, workbookSavedCountKeys);
  const sourceCounts = [
    ocrCount > 0
      ? localize('com_ui_steel_activity_source_count', {
          source: localize('com_ui_steel_activity_source_ocr'),
          count: ocrCount,
        })
      : null,
    paddleOcrCount > 0
      ? localize('com_ui_steel_activity_source_count', {
          source: localize('com_ui_steel_activity_source_paddleocr'),
          count: paddleOcrCount,
        })
      : null,
    workbookCount > 0
      ? localize('com_ui_steel_activity_source_count', {
          source: localize('com_ui_steel_activity_source_workbook'),
          count: workbookCount,
        })
      : null,
  ].filter((countText): countText is string => Boolean(countText));

  if (sourceCounts.length > 0) {
    return sourceCounts.join(', ');
  }

  const savedCount = getSavedCountTotal(event);
  return savedCount > 0
    ? localize('com_ui_steel_activity_records_saved', { count: savedCount })
    : null;
}

const SteelActivity = memo(function SteelActivity({
  messageId,
  isCreatedByUser,
}: SteelActivityProps) {
  const localize = useLocalize();
  const events = useRecoilValue(steelNativeActivityByMessageId(messageId));

  const displayEvents = useMemo(
    () => events.filter((event) => event.type === 'parse_status' || getSavedCountTotal(event) > 0),
    [events],
  );

  if (isCreatedByUser || displayEvents.length === 0) {
    return null;
  }

  return (
    <div
      aria-label={localize('com_ui_steel_activity')}
      className="mt-1 flex flex-col gap-1 text-xs text-text-secondary"
    >
      {displayEvents.map((event, index) => {
        const savedText = getSavedCountText(event, localize);
        return (
          <div
            key={`${event.type}-${event.source}-${event.messageId ?? messageId}-${event.providerToolCallId ?? index}`}
            className="flex min-h-5 items-center gap-1.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 dark:border-border-medium dark:bg-surface-tertiary"
          >
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-green-600" />
            <span className="min-w-0 truncate">{getActivityLabel(event, localize)}</span>
            {savedText && <span className="shrink-0 text-text-tertiary">{savedText}</span>}
          </div>
        );
      })}
    </div>
  );
});

export default SteelActivity;
