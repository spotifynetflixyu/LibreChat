import { ContentTypes } from 'librechat-data-provider';
import type { TMessageContentParts } from 'librechat-data-provider';

export type ContentBand = 'activity' | 'body';

export function isActivityPart(part: TMessageContentParts): boolean {
  return (
    part.type === ContentTypes.TOOL_CALL ||
    part.type === ContentTypes.THINK ||
    part.type === ContentTypes.ACTIVITY_LABEL ||
    part.type === ContentTypes.SUMMARY
  );
}

/** Changes presentation order without changing transcript indexes or identities. */
export function activitiesFirst<T>(items: readonly T[], isActivity: (item: T) => boolean): T[] {
  const activities: T[] = [];
  const body: T[] = [];
  for (const item of items) {
    (isActivity(item) ? activities : body).push(item);
  }
  return [...activities, ...body];
}
