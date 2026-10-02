import { createContext, memo, useContext } from 'react';
import { cn } from '~/utils';

type CursorOwner = 'message' | 'content';
type CursorVisibility = { visible: boolean; owner: CursorOwner };

/** Lets a message host own one cursor across all nested content renderers. */
export const CursorVisibilityContext = createContext<CursorVisibility>({
  visible: true,
  owner: 'content',
});

export function useCursorVisibility(owner: CursorOwner = 'content'): boolean {
  const cursor = useContext(CursorVisibilityContext);
  return cursor.visible && cursor.owner === owner;
}

type EmptyTextPartProps = {
  owner?: CursorOwner;
  /**
   * Centers the 12px dot (style.css `.result-thinking`) on the axis of the
   * size-6 message-header icon above it: (24 − 12) / 2, as inline-start
   * padding so the axis holds when the document flips to RTL. Only for
   * placeholders rendering directly beneath the header — leading rows and
   * nested contexts (activity groups, parallel columns, mid-stream parts)
   * keep the flush default.
   */
  underHeaderIcon?: boolean;
};

/** Streaming cursor placeholder — no bottom margin to match Container's structure and prevent CLS */
const EmptyTextPart = memo(({ underHeaderIcon = false, owner = 'content' }: EmptyTextPartProps) => {
  const visible = useCursorVisibility(owner);
  if (!visible) {
    return null;
  }
  return (
    <div className="text-message flex min-h-[20px] flex-col items-start gap-3 overflow-visible">
      <div className="markdown prose dark:prose-invert light w-full break-words">
        <div className={cn('absolute', underHeaderIcon && 'ps-1.5')}>
          <p className="submitting relative">
            <span className="result-thinking" />
          </p>
        </div>
      </div>
    </div>
  );
});

export default EmptyTextPart;
