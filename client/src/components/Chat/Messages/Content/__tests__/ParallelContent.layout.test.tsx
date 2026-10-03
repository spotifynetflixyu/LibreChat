import React from 'react';
import { ContentTypes } from 'librechat-data-provider';
import { render, within } from '@testing-library/react';
import type { TMessageContentParts } from 'librechat-data-provider';

jest.mock('~/utils', () => ({
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  getPartKeyIndex: (_part: TMessageContentParts, idx: number) => idx,
}));

jest.mock('~/Providers', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return { SearchContext: react.createContext({}) };
});

jest.mock('~/utils/lanes', () => {
  const { ContentTypes: types } = jest.requireActual(
    'librechat-data-provider',
  ) as typeof import('librechat-data-provider');
  return {
    MIN_PARALLEL_LANES: 2,
    UNATTRIBUTED_LANE: 'unknown',
    isLaneMarkerPart: (part: TMessageContentParts | undefined) => part?.type === types.AGENT_UPDATE,
  };
});

jest.mock('~/utils/activityLabels', () => {
  const { ContentTypes: types } = jest.requireActual(
    'librechat-data-provider',
  ) as typeof import('librechat-data-provider');
  return {
    getActivityLabelPart: (part: TMessageContentParts | undefined) =>
      part?.type === types.ACTIVITY_LABEL ? part : undefined,
    getActivityLabelText: (part: TMessageContentParts | undefined) => {
      const text = part?.[types.ACTIVITY_LABEL];
      return typeof text === 'string' ? text : '';
    },
    lastCursorContentIdx: (parts: ReadonlyArray<TMessageContentParts | undefined> | undefined) => {
      for (let idx = (parts?.length ?? 0) - 1; idx >= 0; idx -= 1) {
        if (parts?.[idx]?.type) {
          return idx;
        }
      }
      return -1;
    },
  };
});

jest.mock('../MemoryArtifacts', () => ({ __esModule: true, default: () => null }));
jest.mock('~/components/Web/Sources', () => ({ __esModule: true, default: () => null }));
jest.mock('../SiblingHeader', () => ({
  __esModule: true,
  default: ({ agentId }: { agentId?: string }) => (
    <div data-testid="sibling-header" data-agent-id={agentId} />
  ),
}));
jest.mock('../Parts', () => ({
  EmptyText: () => <div data-testid="empty-text" />,
}));
jest.mock('../Container', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { ParallelContentRenderer } from '../ParallelContent';

const textPart = (
  text: string,
  metadata: Partial<TMessageContentParts> = {},
): TMessageContentParts => ({ type: ContentTypes.TEXT, text, ...metadata }) as TMessageContentParts;

const activityPart = (
  type: ContentTypes.TOOL_CALL | ContentTypes.THINK,
  metadata: Partial<TMessageContentParts> = {},
): TMessageContentParts => ({ type, ...metadata }) as TMessageContentParts;

const renderPart = (part: TMessageContentParts, idx: number) => (
  <div
    key={idx}
    data-testid={`part-${idx}`}
    data-part-type={part.type}
    data-part-text={part.type === ContentTypes.TEXT ? part.text : undefined}
  />
);

const renderContent = (
  content: TMessageContentParts[],
  isSubmitting = false,
  contentBand?: 'activity' | 'body',
) =>
  render(
    <ParallelContentRenderer
      content={content}
      messageId="message-1"
      isSubmitting={isSubmitting}
      contentBand={contentBand}
      renderPart={renderPart}
    />,
  );

describe('ParallelContentRenderer layout', () => {
  it('puts activities before text in every stretch while preserving indexes and lane identities', () => {
    const content = [
      textPart('before text'),
      activityPart(ContentTypes.TOOL_CALL),
      textPart('lane one text', { groupId: 1, agentId: 'agent-a' }),
      activityPart(ContentTypes.THINK, { groupId: 1, agentId: 'agent-a' }),
      textPart('lane two text', { groupId: 1, agentId: 'agent-b____1' }),
      activityPart(ContentTypes.TOOL_CALL, { groupId: 1, agentId: 'agent-b____1' }),
      textPart('between text'),
      textPart('second lane one text', { groupId: 2, agentId: 'agent-a' }),
      activityPart(ContentTypes.TOOL_CALL, { groupId: 2, agentId: 'agent-a' }),
      textPart('second lane two text', { groupId: 2, agentId: 'agent-b____1' }),
      activityPart(ContentTypes.THINK, { groupId: 2, agentId: 'agent-b____1' }),
      textPart('after text'),
      activityPart(ContentTypes.TOOL_CALL),
    ];

    const { container } = renderContent(content);

    expect(
      Array.from(container.querySelectorAll('[data-testid^="part-"]')).map((node) =>
        node.getAttribute('data-testid'),
      ),
    ).toEqual([
      'part-1',
      'part-3',
      'part-5',
      'part-8',
      'part-10',
      'part-12',
      'part-0',
      'part-2',
      'part-4',
      'part-6',
      'part-7',
      'part-9',
      'part-11',
    ]);

    const groups = container.querySelectorAll('.sibling-content-group');
    expect(groups).toHaveLength(4);
    for (const group of groups) {
      expect(
        Array.from(group.querySelectorAll('[data-testid="sibling-header"]')).map((node) =>
          node.getAttribute('data-agent-id'),
        ),
      ).toEqual(['agent-a', 'agent-b____1']);
    }
  });

  it('keeps placeholder columns available while rendering the filled lane', () => {
    const placeholder = {
      type: '',
      groupId: 3,
      agentId: 'agent-a',
    } as unknown as TMessageContentParts;
    const filled = textPart('filled lane', { groupId: 3, agentId: 'agent-b____1' });

    const { container } = renderContent([placeholder, filled], true);
    const group = container.querySelector('.sibling-content-group');

    expect(group).not.toBeNull();
    expect(
      Array.from(group!.querySelectorAll('[data-testid="sibling-header"]')).map((node) =>
        node.getAttribute('data-agent-id'),
      ),
    ).toEqual(['agent-a', 'agent-b____1']);
    expect(within(group as HTMLElement).getByTestId('empty-text')).toBeInTheDocument();
    expect(within(group as HTMLElement).getByTestId('part-1')).toBeInTheDocument();
  });

  it('keeps handoff updates in the body band', () => {
    const handoff = {
      type: ContentTypes.AGENT_UPDATE,
      [ContentTypes.AGENT_UPDATE]: { agentId: 'agent-b' },
      agentId: 'agent-b',
    } as unknown as TMessageContentParts;
    const content = [handoff, textPart('answer'), activityPart(ContentTypes.TOOL_CALL)];

    const activity = renderContent(content, false, 'activity');
    expect(
      Array.from(activity.container.querySelectorAll('[data-testid^="part-"]')).map((node) =>
        node.getAttribute('data-testid'),
      ),
    ).toEqual(['part-2']);
    activity.unmount();

    const body = renderContent(content, false, 'body');
    expect(
      Array.from(body.container.querySelectorAll('[data-testid^="part-"]')).map((node) =>
        node.getAttribute('data-testid'),
      ),
    ).toEqual(['part-0', 'part-1']);
  });
});
