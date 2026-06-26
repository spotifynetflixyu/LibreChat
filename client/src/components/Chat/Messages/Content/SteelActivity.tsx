import { memo, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useRecoilValue } from 'recoil';
import type { SteelNativeActivityEvent } from '~/store/steel';
import { steelNativeActivityByMessageId } from '~/store/steel';
import useLocalize from '~/hooks/useLocalize';

type SteelActivityProps = {
  messageId: string;
  isCreatedByUser?: boolean;
};

function getSavedCountTotal(event: SteelNativeActivityEvent): number {
  return Object.values(event.savedCounts ?? {}).reduce((total, count) => total + count, 0);
}

function getActivityLabel(event: SteelNativeActivityEvent, localize: ReturnType<typeof useLocalize>) {
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
        const savedCount = getSavedCountTotal(event);
        const savedText =
          savedCount > 0
            ? localize('com_ui_steel_activity_records_saved', { count: savedCount })
            : null;
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
