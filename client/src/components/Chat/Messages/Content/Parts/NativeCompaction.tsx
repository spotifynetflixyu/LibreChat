import { memo } from 'react';
import { ScrollText } from 'lucide-react';
import type { OAuthCompactionEvent } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type NativeCompactionProps = {
  event: OAuthCompactionEvent;
  isSubmitting: boolean;
};

const NativeCompaction = memo(({ event, isSubmitting }: NativeCompactionProps) => {
  const localize = useLocalize();
  const isActive = event.phase === 'started' && isSubmitting;

  if (event.phase === 'cancelled' || (event.phase === 'started' && !isSubmitting)) {
    return null;
  }

  let label = localize('com_ui_native_compaction_failed');
  if (event.phase === 'started') label = localize('com_ui_native_compaction_active');
  if (event.phase === 'completed') label = localize('com_ui_native_compaction_completed');

  return (
    <div
      className={cn('flex items-center gap-2 py-2 text-sm text-text-secondary')}
      role="status"
      aria-live="polite"
      aria-busy={isActive || undefined}
    >
      <ScrollText className="icon-sm shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
});

NativeCompaction.displayName = 'NativeCompaction';

export default NativeCompaction;
