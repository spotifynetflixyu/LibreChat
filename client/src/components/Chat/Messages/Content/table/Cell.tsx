import { Children, cloneElement, isValidElement, memo, useId, useLayoutEffect, useMemo, useRef } from 'react';
import { atom, useAtom } from 'jotai';
import { Button } from '@librechat/client';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { ExtraProps } from 'react-markdown';
import { useLocalize } from '~/hooks';

function keepNumbersTogether(children: ReactNode): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === 'number') return <span className="whitespace-nowrap">{child}</span>;
    if (typeof child === 'string') {
      const parts = child.split(/([+-]?\d+(?:[.,]\d+)*(?:[eE][+-]?\d+)?%?)/);
      if (parts.length === 1) return child;
      return parts.map((part, index) => index % 2 === 1
        ? <span key={index} className="whitespace-nowrap">{part}</span>
        : part);
    }
    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children !== undefined) {
      return cloneElement(child, undefined, keepNumbersTogether(child.props.children));
    }
    return child;
  });
}

export const CollapsibleCellContent = memo(function CollapsibleCellContent({ children, canCollapse = true, className }: {
  children: ReactNode;
  canCollapse?: boolean;
  className?: string;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const contentId = useId();
  const stateAtom = useMemo(() => atom({ expanded: false, overflows: false }), []);
  const [{ expanded, overflows }, setState] = useAtom(stateAtom);
  const localize = useLocalize();
  const content = useMemo(() => keepNumbersTogether(children), [children]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!canCollapse || !content) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight) || 24;
      const nextOverflows = content.scrollHeight > lineHeight * 3 + 1;
      setState((current) => current.overflows === nextOverflows ? current : { ...current, overflows: nextOverflows });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [canCollapse, children, setState]);

  return (
    <div className={className} data-markdown-cell-wrapper>
      <div ref={contentRef} id={contentId} data-markdown-cell-content
        className={`leading-6 [overflow-wrap:anywhere]${canCollapse && !expanded ? ' line-clamp-3' : ''}`}>
        {content}
      </div>
      {canCollapse && overflows && (
        <div className="relative mt-1 h-6">
          <Button type="button" variant="secondary" shape="round" size="sm" className="absolute left-0 top-0 h-6 border border-border-medium px-2 py-0 text-xs"
            aria-expanded={expanded} aria-controls={contentId}
            onClick={() => setState((current) => ({ ...current, expanded: !current.expanded }))}>
            {localize(expanded ? 'com_ui_table_cell_show_less' : 'com_ui_table_cell_show_all', {
              defaultValue: localize(expanded ? 'com_ui_show_less' : 'com_ui_show_all'),
            })}
          </Button>
        </div>
      )}
    </div>
  );
});

const MarkdownCell = memo(function MarkdownCell({ children, node: _node, ...props }: ComponentPropsWithoutRef<'td'> & ExtraProps) {
  return (
    <td {...props}>
      <CollapsibleCellContent>{children}</CollapsibleCellContent>
    </td>
  );
});

export default MarkdownCell;
