import { memo, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import type {
  SteelNativeActivityEvent,
  SteelNativeSavedCounts,
  SteelNativeTableCounts,
} from '~/store/steel';
import { steelNativeActivityByMessageId } from '~/store/steel';
import useLocalize from '~/hooks/useLocalize';

type SteelActivityProps = {
  messageId: string;
  isCreatedByUser?: boolean;
};

type Localize = ReturnType<typeof useLocalize>;
type LocalizeKey = Parameters<Localize>[0];

const ocrSavedCountKeys = new Set(['ocr_extract']);
const paddleOcrSavedCountKeys = new Set(['paddleocr_preflight']);
const workbookRowSavedCountKeys = new Set(['working_order_row']);
const ocrTableCountKeys = new Set(['ocr_table']);
const workbookTableCountKeys = new Set(['system_order_table']);

function getSavedCountTotal(event: SteelNativeActivityEvent): number {
  return Object.values(event.savedCounts ?? {}).reduce((total, count) => {
    if (!Number.isFinite(count) || count <= 0) {
      return total;
    }

    return total + count;
  }, 0);
}

function getCountForKeys(
  counts: SteelNativeSavedCounts | SteelNativeTableCounts | undefined,
  keys: Set<string>,
) {
  if (!counts) {
    return 0;
  }

  return Object.entries(counts).reduce((total, [key, count]) => {
    if (!keys.has(key) || !Number.isFinite(count) || count <= 0) {
      return total;
    }

    return total + count;
  }, 0);
}

function formatCountText(
  localize: Localize,
  sourceKey: LocalizeKey,
  count: number,
) {
  return localize('com_ui_steel_activity_source_count', {
    source: localize(sourceKey),
    count,
  });
}

function getCountTexts({
  savedCounts,
  tableCounts,
  localize,
}: {
  savedCounts?: SteelNativeSavedCounts;
  tableCounts?: SteelNativeTableCounts;
  localize: ReturnType<typeof useLocalize>;
}) {
  const rawOcrCount = getCountForKeys(savedCounts, paddleOcrSavedCountKeys);
  const explicitOcrTableCount = getCountForKeys(tableCounts, ocrTableCountKeys);
  const legacyOcrTableCount =
    explicitOcrTableCount > 0 ? 0 : getCountForKeys(savedCounts, ocrSavedCountKeys);
  const ocrTableCount = explicitOcrTableCount || legacyOcrTableCount;
  const workbookTableCount = getCountForKeys(tableCounts, workbookTableCountKeys);
  const workbookRowCount = getCountForKeys(savedCounts, workbookRowSavedCountKeys);

  return [
    rawOcrCount > 0
      ? formatCountText(localize, 'com_ui_steel_activity_source_ocr_raw', rawOcrCount)
      : null,
    ocrTableCount > 0
      ? formatCountText(localize, 'com_ui_steel_activity_source_ocr_tables', ocrTableCount)
      : null,
    workbookTableCount > 0
      ? formatCountText(
          localize,
          'com_ui_steel_activity_source_workbook_tables',
          workbookTableCount,
        )
      : null,
    workbookRowCount > 0
      ? formatCountText(
          localize,
          'com_ui_steel_activity_source_workbook_rows',
          workbookRowCount,
        )
      : null,
  ].filter((countText): countText is string => Boolean(countText));
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
  const sourceCounts = getCountTexts({
    savedCounts: event.savedCounts,
    tableCounts: event.savedTableCounts,
    localize,
  });

  if (sourceCounts.length > 0) {
    return localize('com_ui_steel_activity_this_turn_counts', {
      counts: sourceCounts.join(', '),
    });
  }

  const savedCount = getSavedCountTotal(event);
  return savedCount > 0
    ? localize('com_ui_steel_activity_this_turn_counts', {
        counts: localize('com_ui_steel_activity_records_saved', { count: savedCount }),
      })
    : null;
}

function getTotalCountText(
  events: SteelNativeActivityEvent[],
  localize: ReturnType<typeof useLocalize>,
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    const sourceCounts = getCountTexts({
      savedCounts: event?.totalSavedCounts,
      tableCounts: event?.totalTableCounts,
      localize,
    });

    if (sourceCounts.length > 0) {
      return localize('com_ui_steel_activity_total_counts', {
        counts: sourceCounts.join(', '),
      });
    }
  }

  return null;
}

function shouldDisplayEvent(event: SteelNativeActivityEvent): boolean {
  if (event.type === 'memory_saved') {
    return getSavedCountTotal(event) > 0;
  }

  return event.parseStatus !== 'saved';
}

const SteelActivity = memo(function SteelActivity({
  messageId,
  isCreatedByUser,
}: SteelActivityProps) {
  const localize = useLocalize();
  const events = useRecoilValue(steelNativeActivityByMessageId(messageId));

  const displayEvents = useMemo(
    () => events.filter(shouldDisplayEvent),
    [events],
  );

  if (isCreatedByUser || displayEvents.length === 0) {
    return null;
  }

  const totalCountText = getTotalCountText(displayEvents, localize);

  return (
    <div
      aria-label={localize('com_ui_steel_activity')}
      className="mt-1 flex flex-col gap-1 text-xs text-text-secondary"
    >
      {totalCountText && (
        <div className="flex min-h-5 items-center gap-1.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 font-medium dark:border-border-medium dark:bg-surface-tertiary">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-green-600" />
          <span className="min-w-0 whitespace-normal break-words">{totalCountText}</span>
        </div>
      )}
      {displayEvents.map((event, index) => {
        const savedText = getSavedCountText(event, localize);
        return (
          <div
            key={`${event.type}-${event.source}-${event.messageId ?? messageId}-${event.providerToolCallId ?? index}`}
            className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md border border-border-light bg-surface-secondary px-2 py-1 dark:border-border-medium dark:bg-surface-tertiary"
          >
            <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-green-600" />
            <span className="min-w-0 truncate">{getActivityLabel(event, localize)}</span>
            {savedText && (
              <span className="min-w-0 whitespace-normal break-words text-text-tertiary">
                {savedText}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
});

export default SteelActivity;
