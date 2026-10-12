import { Tag } from '@librechat/client';
import type { SteelMarkdownVersion, SteelReviewTable } from 'librechat-data-provider';
import { useLocalize } from '~/hooks';

type SteelReviewBadgeProps = {
  table: Pick<SteelReviewTable, 'isLatest' | 'readOnly'>;
  version?: Pick<SteelMarkdownVersion, 'latest' | 'saves'>;
  showReadOnly?: boolean;
};

export default function SteelReviewBadge({ table, version, showReadOnly = false }: SteelReviewBadgeProps) {
  const localize = useLocalize();
  if (showReadOnly && table.readOnly) {
    return (
      <Tag
        className="shrink-0"
        labelClassName="whitespace-nowrap"
        label={localize('com_ui_steel_review_readonly_badge')}
        variant="neutral"
      />
    );
  }

  const latest = table.isLatest && (version?.latest ?? true);
  const label = `${localize(latest ? 'com_ui_steel_review_latest_version' : 'com_ui_steel_review_previous_version')}${version && version.saves > 0 ? ` v${version.saves + 1}` : ''}`;
  return (
    <Tag
      className="shrink-0"
      labelClassName="whitespace-nowrap"
      label={label}
      variant={latest ? 'success' : 'neutral'}
    />
  );
}
